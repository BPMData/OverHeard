import { useCallback, useEffect, useState } from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { LectureTranscript } from '../components/LectureTranscript';
import { VoiceSettingsModal } from '../components/VoiceSettingsModal';
import { WhiteboatIcon } from '../components/WhiteboatIcon';
import { LANGUAGE_MAP, SUPPORTED_LANGUAGES } from '../constants';
import { PACK_NEEDS_CLICK, getChromeAvailability, getOnDeviceAvailability, prepareOnDeviceTranslators, startWaitingPack, waitingPackSize } from '../onDevice';
import { BERGAMOT_APPROXIMATE, bergamotDownloadLabel } from '../translation/bergamot/models';
import { hasBergamotModel } from '../translation/bergamot/engine';
import { piperClient } from '../tts/piperClient';
import { TranslatedByBadge } from '../header/TranslatorPicker';
import { useLecturePlayback } from '../tts/useSpeechPlayback';
import {
  BROWSER_VOICE_ID,
  resolveVoiceId,
  useVoicePreferences,
} from '../tts/voices';
import { PlaybackToolbar, VoiceSelect } from '../tts/VoiceSelect';
import type { ConversationLanguage, LanguageCode } from '../types';
import { ExportLectureButton } from './LectureFiles';
import { LecturePip } from './LecturePip';
import { useStudentRoom } from './useStudentRoom';
import { useStudentTranslations } from './useStudentTranslations';
import { emptyLecture, normalizeRoomCode, validRoomCode } from './protocol';
import { studentRoomUrl } from './roomLink';
import { loadStudentPrefs, saveStudentPrefs } from './studentPrefs';
import '../components/ConversationMode.css';

export function JoinRoomForm() {
  const [code, setCode] = useState('');
  return <form className="room-join" onSubmit={event => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!validRoomCode(normalized)) return;
    window.location.assign(studentRoomUrl(normalized));
  }}>
    <input aria-label="Room code to join" placeholder="Student room code" value={code} maxLength={40}
      onChange={event => setCode(event.target.value)} />
    <button type="submit" disabled={!validRoomCode(normalizeRoomCode(code))}>Join room</button>
  </form>;
}

export function StudentRoom({ code }: { code: string }) {
  const { snapshot, connected, error, waiting } = useStudentRoom(code);
  const [prefs] = useState(loadStudentPrefs);
  const [language, setLanguage] = useState<LanguageCode | 'en'>(prefs.language);
  const [fontSize, setFontSize] = useState(prefs.fontSize);
  const [isDark, setIsDark] = useState(prefs.isDark);
  useEffect(() => saveStudentPrefs({ isDark, language, fontSize }), [isDark, language, fontSize]);
  const [voicePrefs, updateVoicePref] = useVoicePreferences();
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  // A direct room link can restore a language before Chrome has a download gesture.
  const needsLocalPack = !!snapshot && language !== 'en' && (readAloud || !snapshot.selectedLangs.includes(language));
  const [downloadOffer, setDownloadOffer] = useState<LanguageCode | null>(null);
  // Percent of an on-device model download this page started, shown next to the language
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  // The offer is a Bergamot model (its size is known) rather than a Chrome pack
  const [offerIsModel, setOfferIsModel] = useState(false);
  useEffect(() => {
    let active = true;
    setDownloadOffer(null);
    setDownloadPct(null);
    if (needsLocalPack) {
      void getOnDeviceAvailability(language).then(async status => {
        if (!active || status !== 'downloadable') return;
        const viaChrome = (await getChromeAvailability(language)) !== 'unavailable';
        if (!active) return;
        setOfferIsModel(!viaChrome && hasBergamotModel(language));
        setDownloadOffer(language);
      });
    }
    return () => { active = false; };
  }, [language, needsLocalPack]);
  const translations = useStudentTranslations(snapshot, language);
  const studentTranslate = translations.translate;
  const translateLive = useCallback(
    (text: string, lang: ConversationLanguage) => (lang === 'en' ? Promise.resolve(text) : studentTranslate(text, lang)),
    [studentTranslate],
  );
  const state = { ...(snapshot || emptyLecture()), entries: translations.entries,
    selectedLangs: language === 'en' ? [] : [language],
    interim: connected ? snapshot?.interim || '' : '',
    liveTranslations: connected ? translations.liveTranslations : {},
    isListening: connected && !!snapshot?.teacherOnline && !!snapshot?.isListening && !snapshot?.ended };
  const playback = useLecturePlayback({
    entries: state.entries,
    voicePrefs,
    readAloud,
    liveLang: language,
    // Students listen on their own device, so read along while the teacher is still talking
    live: connected ? { interim: snapshot?.interim || '', translate: translateLive, suspendSpeech: true } : null,
  });
  const adjustFont = (delta: number) => setFontSize(value => Math.min(56, Math.max(20, value + delta)));
  return <main className={`conversation-mode ${isDark ? 'conversation-dark' : ''}`}>
    <div className="conversation-settings">
      <a
        href="/"
        className="conversation-brand"
        aria-label="OverHeard — Go to main Columns page"
        title="Back to OverHeard Columns view"
      >
        <WhiteboatIcon app="overheard" size={22} />
        <span>OverHeard</span>
      </a>
      <strong>Room {code}</strong>
      <label>My language
        <select aria-label="My language" value={language} onChange={event => {
          const next = event.target.value as LanguageCode | 'en'; setLanguage(next);
          // Language selection supplies the user gesture required for model downloads.
          if (next !== 'en' && !snapshot?.selectedLangs.includes(next)) prepareOnDeviceTranslators([next]);
        }}>
          <option value="en">English only</option>
          {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name} · {lang.nativeName}</option>)}
        </select>
      </label>
      {needsLocalPack && downloadOffer === language && (
        <button type="button" onClick={() => {
          setDownloadOffer(null);
          prepareOnDeviceTranslators([language], (code, progress) => {
            if (code !== language) return;
            // A Bergamot model waits for a click on a button that shows its size: this one.
            if (progress === PACK_NEEDS_CLICK && waitingPackSize(code)) startWaitingPack(code);
            else if (progress === null) { setDownloadPct(null); setDownloadOffer(language); }
            else if (progress >= 1) setDownloadPct(null);
            else if (progress >= 0) setDownloadPct(Math.round(progress * 100));
          });
        }}>
          {offerIsModel
            ? `Download ${LANGUAGE_MAP[language as LanguageCode].name} for this device (${BERGAMOT_APPROXIMATE[language] ? `${BERGAMOT_APPROXIMATE[language]}, ` : ''}${bergamotDownloadLabel(language)})`
            : 'Download language for this device'}
        </button>
      )}
      {downloadPct !== null && <span role="status">Downloading {LANGUAGE_MAP[language as LanguageCode]?.name}… {downloadPct}%</span>}
      <label>Voice
        <VoiceSelect
          lang={language}
          ariaLabel="Voice"
          value={resolveVoiceId(language, voicePrefs)}
          onChange={(nextVoice) => {
            updateVoicePref(language, nextVoice);
            if (nextVoice !== BROWSER_VOICE_ID) {
              piperClient.preloadVoice(nextVoice);
            }
          }}
        />
      </label>
      <button
        type="button"
        className="inline-flex items-center gap-1.5"
        onClick={() => setIsVoiceSettingsOpen(true)}
        title="Choose default reader voices"
      >
        <Settings className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Settings</span>
      </button>
      <label>
        <input
          type="checkbox"
          checked={readAloud}
          onChange={(event) => {
            const checked = event.target.checked;
            setReadAloud(checked);
            if (checked) {
              piperClient.unlockAudio();
              const activeVoice = resolveVoiceId(language, voicePrefs);
              if (activeVoice !== BROWSER_VOICE_ID) {
                piperClient.preloadVoice(activeVoice);
              }
            }
          }}
        />
        Read aloud
      </label>
      <PlaybackToolbar
        status={playback.status}
        downloadProgress={playback.downloadProgress}
        onTogglePause={playback.togglePause}
        onStop={playback.stop}
      />
      <LecturePip state={state} isDark={isDark} fontSize={fontSize} onAdjustFont={adjustFont}
        prefsPrefix="overheard.studentPip" />
      <ExportLectureButton
        state={{
          entries: state.entries,
          selectedLangs: language !== 'en' ? [language] : (snapshot?.selectedLangs ?? []),
        }}
        roomCode={code}
      />
      <button type="button" aria-label="Smaller text" onClick={() => adjustFont(-4)}>A−</button>
      <button type="button" aria-label="Larger text" onClick={() => adjustFont(4)}>A+</button>
      <button
        type="button"
        className="student-theme-btn"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        onClick={() => setIsDark(value => !value)}
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <a href="/">Leave room</a>
    </div>
    <p className="conversation-help">Follow your teacher’s captions in your language. Pop them out to keep reading while you work.</p>
    <p aria-live="polite">{error || (snapshot?.ended ? 'This lecture has ended.' : !snapshot?.teacherOnline
      ? 'Teacher disconnected. Waiting for them to reconnect…' : state.isListening ? 'Connected · Lecture live' : 'Connected · Teacher paused')}</p>
    {translations.translatedBy && language !== 'en' && (
      <p className="text-xs"><TranslatedByBadge provider={translations.translatedBy} /></p>
    )}
    {waiting && <p className="room-waiting">This page joins automatically when your teacher starts. Keep it open.</p>}
    {error && !snapshot && <JoinRoomForm />}
    {translations.hasFailures && <button type="button" onClick={translations.retry}>Retry unavailable translations</button>}
    <LectureTranscript entries={state.entries} selectedLangs={state.selectedLangs} fontSize={fontSize} isDark={isDark}
      isListening={state.isListening} speechLocal={null} interim={state.interim} liveTranslations={state.liveTranslations}
      activePlayback={playback.activePlayback} onPlayFrom={playback.playFrom}
      onTogglePause={playback.togglePause} onStopPlayback={playback.stop} />
    <VoiceSettingsModal
      isOpen={isVoiceSettingsOpen}
      onClose={() => setIsVoiceSettingsOpen(false)}
      isDark={isDark}
    />
  </main>;
}
