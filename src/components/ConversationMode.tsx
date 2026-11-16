import { useWakeLock } from '../wakeLock';
import { withMicAccess, type MicBlock } from '../micPermission';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DEFAULT_LANGUAGES, LANGUAGE_MAP, SUPPORTED_LANGUAGES } from '../constants';
import { captionTextStyle, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import type { ConversationLanguage, LanguageCode } from '../types';
import {
  createMessage,
  correctMessage,
  messagesReducer,
  otherSide,
  type Message,
  type Side,
} from '../conversation/state';
import { useConversationSpeech } from '../conversation/useConversationSpeech';
import { useLectureMode } from '../conversation/useLectureMode';
import {
  isOnDeviceTranslationSupported,
  prepareOnDeviceConversation,
  type PackProgress,
} from '../onDevice';
import {
  conversationCsv,
  loadConversationSettings,
  parseConversationCsv,
  saveConversationSettings,
  type ConversationSubMode,
} from './conversationSettings';
import { LectureTranscript } from './LectureTranscript';
import { VoiceSettingsModal } from './VoiceSettingsModal';
import { WhiteboatIcon } from './WhiteboatIcon';
import { OpenFromDriveButton, SaveLectureToDriveControl } from './DriveLectureActions';
import type { SaveLectureToDriveResult } from '../lib/googleDrive';
import './ConversationMode.css';
import { TeacherRoomControls } from '../rooms/TeacherRoomControls';
import { LectureFiles } from '../rooms/LectureFiles';
import { LecturePip } from '../rooms/LecturePip';
import { piperClient } from '../tts/piperClient';
import { useLecturePlayback, useTwoWayPlayback } from '../tts/useSpeechPlayback';
import {
  BROWSER_VOICE_ID,
  resolveVoiceId,
  useVoicePreferences,
} from '../tts/voices';
import { PlaybackToolbar, VoiceSelect } from '../tts/VoiceSelect';
import type { LectureEntry } from '../conversation/lectureState';

interface Props {
  active: boolean;
  fontSize: number;
  isDark: boolean;
  translate: (
    text: string,
    target: ConversationLanguage,
    source: ConversationLanguage,
  ) => Promise<string>;
  onExit: () => void;
  onStartAttempt?: () => void;
  onPermissionDenied: (reason?: MicBlock) => void;
  initialLanguage?: ConversationLanguage;
  selectedLangs?: LanguageCode[];
  onOpenLanguages?: () => void;
  onSetLanguages?: (languages: LanguageCode[]) => void;
  mtPreference: string;
  translatorPicker?: React.ReactNode;
  onAdjustFont?: (delta: number) => void;
  permissionBanner?: React.ReactNode;
  /** Receives on-device download progress, for the panel below */
  onPackProgress?: PackProgress;
  /** The on-device download progress panel (renders nothing when idle) */
  packPanel?: React.ReactNode;
  /** Lecture imported from the base web-page */
  importedLecture?: { seq: number; entries: LectureEntry[] } | null;
}
const direction = (lang: ConversationLanguage) => (lang === 'en' ? 'ltr' : LANGUAGE_MAP[lang].dir);
const color = (side: Side, lang: ConversationLanguage) =>
  side === 'a'
    ? lang === 'en'
      ? ENGLISH_CAPTION_COLOR
      : languageCaptionColor(0)
    : languageCaptionColor(1);
export function ConversationMode({
  active,
  fontSize,
  isDark,
  translate,
  onExit,
  onStartAttempt,
  onPermissionDenied,
  initialLanguage,
  selectedLangs,
  onOpenLanguages,
  onSetLanguages,
  mtPreference,
  translatorPicker,
  onAdjustFont,
  permissionBanner,
  onPackProgress,
  packPanel,
  importedLecture,
}: Props) {
  const [settings, setSettings] = useState(() => loadConversationSettings(initialLanguage));
  const targetLangs: LanguageCode[] =
    selectedLangs
      ? selectedLangs
      : initialLanguage && initialLanguage !== 'en'
        ? [initialLanguage]
        : DEFAULT_LANGUAGES;
  const isLecture = settings.mode === 'lecture';
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [sender, setSender] = useState<Side>('a');
  const [text, setText] = useState('');
  const [newMessage, setNewMessage] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [uiError, setUiError] = useState('');
  const [driveStatus, setDriveStatus] = useState<{ message: string; link?: string } | null>(null);
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [voicePrefs, persistVoicePref] = useVoicePreferences();
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [lecturePlaybackLang, setLecturePlaybackLang] = useState<ConversationLanguage>(
    () => targetLangs[0] ?? 'en',
  );
  const [lectureReadAloud, setLectureReadAloud] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const following = useRef(true);
  const requests = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  const lastImportedSeq = useRef(0);
  const updateVoicePref = useCallback(
    (lang: ConversationLanguage, voiceId: string) => {
      persistVoicePref(lang, voiceId);
      if (voiceId !== BROWSER_VOICE_ID) {
        piperClient.preloadVoice(voiceId);
      }
    },
    [persistVoicePref],
  );
  const send = useCallback(
    (side: Side, value: string) => {
      if (value.trim())
        dispatch({ type: 'add', message: createMessage(side, value.trim(), settings) });
    },
    [settings],
  );
  const speech = useConversationSpeech({
    participants: settings,
    switchAfterMs: settings.manualTurns ? null : settings.switchAfterMs,
    onSend: send,
    onPermissionDenied,
    onUnsupportedLanguage: (language) =>
      setUiError(
        `Speech recognition doesn't support ${SUPPORTED_LANGUAGES.find((l) => l.code === language)?.name ?? 'English'} in this browser. You can type a message below.`,
      ),
  });
  const lecture = useLectureMode({
    active: active && isLecture,
    selectedLangs: targetLangs,
    mtPreference,
    translate,
    onStartAttempt,
    onPermissionDenied,
    onPackProgress,
  });
  const lectureLangs: ConversationLanguage[] = ['en', ...targetLangs];
  const effectiveLectureLang = lectureLangs.includes(lecturePlaybackLang)
    ? lecturePlaybackLang
    : (targetLangs[0] ?? 'en');
  const lecturePlayback = useLecturePlayback({
    entries: active && isLecture ? lecture.entries : [],
    voicePrefs,
    readAloud: active && isLecture && lectureReadAloud,
    liveLang: effectiveLectureLang,
    onBeforePlay: lecture.speech.suspend,
  });
  const twoWayPlayback = useTwoWayPlayback({
    voicePrefs,
    onSuspendSpeech: speech.suspend,
    onResumeSpeech: speech.resume,
  });
  const wasLecturePlaying = useRef(false);
  useEffect(() => {
    const isPlaybackActive =
      lecturePlayback.status === 'playing' || lecturePlayback.status === 'downloading';
    if (isPlaybackActive) {
      wasLecturePlaying.current = true;
    } else if (wasLecturePlaying.current) {
      wasLecturePlaying.current = false;
      lecture.speech.resume();
    }
  }, [lecturePlayback.status, lecture.speech.resume]);
  const lectureState = { entries: lecture.entries, selectedLangs: targetLangs,
    interim: active && isLecture ? lecture.speech.interim : '',
    liveTranslations: lecture.liveTranslations,
    isListening: active && isLecture && lecture.speech.isListening };
  useEffect(() => {
    if (!importedLecture || importedLecture.seq === lastImportedSeq.current) return;
    lastImportedSeq.current = importedLecture.seq;
    setSettings((s) => (s.mode === 'lecture' ? s : { ...s, mode: 'lecture' }));
    lecture.replace(importedLecture.entries, { preserveIds: true });
  }, [importedLecture, lecture.replace]);
  useEffect(() => {
    if (active && !isLecture && settings.manualTurns && speech.isListening)
      nextButton.current?.focus();
  }, [active, isLecture, settings.manualTurns, speech.isListening]);
  useWakeLock(active);
  useEffect(() => saveConversationSettings(settings), [settings]);
  useEffect(() => {
    if (!active || isLecture) {
      speech.stop();
      twoWayPlayback.cancelAll();
    }
    if (!active || !isLecture) {
      lecturePlayback.stop();
    }
  }, [active, isLecture, speech.stop, twoWayPlayback.cancelAll, lecturePlayback.stop]);
  useEffect(() => {
    if (!active || isLecture) return;
    const handler = (event: KeyboardEvent) => {
      if (event.code === 'Space' && settings.manualTurns && speech.isListening) {
        const target = event.target;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (target instanceof Element &&
            target !== nextButton.current &&
            target.closest('button,a,summary,input,textarea,select,[contenteditable]'))
        )
          return;
        event.preventDefault();
        if (!event.repeat) speech.setTurn(otherSide(speech.turn));
        return;
      }
      if (
        event.repeat ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        speech.setTurn(event.code === 'ShiftLeft' ? 'a' : 'b');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, settings.manualTurns, speech.isListening, speech.turn, speech.setTurn]);
  useEffect(() => {
    for (const message of messages) {
      const key = `${message.id}:${message.revision}`;
      if (message.status !== 'translating' || requests.current.has(key)) continue;
      requests.current.add(key);
      void translate(message.original, message.reader.lang, message.sender.lang).then(
        (translated) =>
          dispatch({ type: 'resolve', id: message.id, revision: message.revision, translated }),
        () =>
          dispatch({
            type: 'resolve',
            id: message.id,
            revision: message.revision,
            translated: null,
          }),
      );
    }
  }, [messages, translate]);
  useEffect(() => {
    if (!active || isLecture || !settings.readAloud) return;
    const pending = messages.filter(
      (m) => m.status === 'done' && !spoken.current.has(`${m.id}:${m.revision}`),
    );
    if (!pending.length) return;
    const speakable = pending.filter(
      (m) =>
        piperClient.shouldUsePiper(m.reader.lang, resolveVoiceId(m.reader.lang, voicePrefs)) ||
        Boolean(window.speechSynthesis),
    );
    if (!speakable.length) return;
    speakable.forEach((m) => spoken.current.add(`${m.id}:${m.revision}`));
    twoWayPlayback.enqueueAuto(
      speakable.map((m) => ({
        id: m.id,
        text: m.translated || m.original,
        lang: m.reader.lang,
      })),
    );
  }, [messages, active, isLecture, settings.readAloud, voicePrefs, twoWayPlayback.enqueueAuto]);
  useEffect(() => {
    if (!settings.readAloud) messages.forEach((m) => spoken.current.add(`${m.id}:${m.revision}`));
  }, [messages, settings.readAloud]);
  useEffect(() => {
    if (following.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    else if (messages.length) setNewMessage(true);
  }, [messages, speech.draft, speech.interim, active]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const exit = () => {
    speech.stop();
    lecture.stop();
    twoWayPlayback.cancelAll();
    lecturePlayback.stop();
    if (document.fullscreenElement === root.current) void document.exitFullscreen();
    onExit();
  };
  const switchSubMode = (nextMode: ConversationSubMode) => {
    if (nextMode === settings.mode) return;
    speech.stop();
    lecture.stop();
    twoWayPlayback.cancelAll();
    lecturePlayback.stop();
    setUiError('');
    lecture.setUiError('');
    setSettings((s) => ({ ...s, mode: nextMode }));
  };
  const start = () => {
    onStartAttempt?.();
    setUiError('');
    // Downloads need this click, and the automatic hand-off between speakers isn't one,
    // so fetch every pack both people will need now.
    const langs = { a: settings.a.lang, b: settings.b.lang };
    if (mtPreference === 'on-device') {
      prepareOnDeviceConversation(langs, onPackProgress);
    } else if (mtPreference === 'auto' && isOnDeviceTranslationSupported()) {
      // Auto translates on this device once packs are ready; speech stays on Google's service
      prepareOnDeviceConversation(langs, onPackProgress, { speech: false });
    }
    withMicAccess(
      () => speech.start(mtPreference === 'on-device'),
      (reason) => onPermissionDenied(reason),
    );
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([conversationCsv(messages)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content =
        typeof file.text === 'function' ? await file.text() : await new Response(file).text();
      const imported = parseConversationCsv(content, settings);
      setUiError('');
      imported.forEach((m) => {
        if (m.status === 'done') spoken.current.add(`${m.id}:${m.revision}`);
      });
      dispatch({ type: 'import', messages: imported });
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Could not import CSV.');
    }
  };
  const renderMessage = (message: Message) => {
    const placedSide = settings.placement === 'speaker' ? message.side : otherSide(message.side);
    const done = message.status === 'done';
    const isSpeakingThisBubble = twoWayPlayback.playingMessageId === message.id;
    return (
      <article key={message.id} className={`conversation-bubble side-${placedSide}`}>
        <div className="conversation-meta">
          <span>
            {message.sender.name} ·{' '}
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </span>
          <span className="lecture-play-actions">
            {done && (
              <button
                type="button"
                className="conversation-play-btn"
                aria-label={
                  isSpeakingThisBubble
                    ? `Stop reading ${message.original}`
                    : `Read aloud: ${message.original}`
                }
                title={isSpeakingThisBubble ? 'Stop reading' : 'Read aloud'}
                onClick={() =>
                  twoWayPlayback.togglePlayMessage({
                    id: message.id,
                    text: message.translated || message.original,
                    lang: message.reader.lang,
                  })
                }
              >
                {isSpeakingThisBubble ? '⏹' : '▶'}
              </button>
            )}
            <button
              aria-label={`Correct speaker for ${message.original}`}
              title="Move to the other speaker"
              onClick={() => dispatch({ type: 'correct', message: correctMessage(message) })}
            >
              ⇄
            </button>
          </span>
        </div>
        <div style={{ fontSize }} dir={direction(done ? message.reader.lang : message.sender.lang)}>
          <span style={captionTextStyle(color(message.side, message.sender.lang), isDark)}>
            {done ? message.translated || message.original : message.original}
          </span>
        </div>
        {message.status === 'translating' && (
          <small className="conversation-pulse">Translating…</small>
        )}
        {message.status === 'error' && (
          <small className="conversation-error">translation unavailable</small>
        )}
        {done && message.sender.lang !== message.reader.lang && (
          <div
            className="conversation-original"
            style={{ fontSize: fontSize * 0.6 }}
            dir={direction(message.sender.lang)}
          >
            {message.original}
          </div>
        )}
      </article>
    );
  };
  return (
    <div
      ref={root}
      className={`conversation-mode ${isDark ? 'conversation-dark' : ''}`}
      hidden={!active}
    >
      {permissionBanner}
      <div className="conversation-settings">
        <span className="conversation-brand">
          <WhiteboatIcon app="overheard" size={22} />
          <span>OverHeard</span>
        </span>
        <div className="conversation-submode" role="group" aria-label="Conversation workspace mode">
          <button
            type="button"
            aria-pressed={!isLecture}
            className={!isLecture ? 'is-active' : ''}
            onClick={() => switchSubMode('two-way')}
          >
            Two-way
          </button>
          <button
            type="button"
            aria-pressed={isLecture}
            className={isLecture ? 'is-active' : ''}
            onClick={() => switchSubMode('lecture')}
          >
            Lecture
          </button>
        </div>
        {!isLecture ? (
          <>
            {(['a', 'b'] as const).map((side) => (
              <fieldset key={side}>
                <legend>Side {side.toUpperCase()}</legend>
                <input
                  aria-label={`Side ${side.toUpperCase()} name`}
                  value={settings[side].name}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [side]: { ...s[side], name: e.target.value } }))
                  }
                />
                <select
                  aria-label={`Side ${side.toUpperCase()} language`}
                  value={settings[side].lang}
                  disabled={speech.isListening}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      [side]: { ...s[side], lang: e.target.value as ConversationLanguage },
                    }))
                  }
                >
                  <option value="en">English</option>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <VoiceSelect
                  lang={settings[side].lang}
                  ariaLabel={`Side ${side.toUpperCase()} voice`}
                  value={resolveVoiceId(settings[side].lang, voicePrefs)}
                  onChange={(voiceId) => updateVoicePref(settings[side].lang, voiceId)}
                />
                <button onClick={() => speech.setTurn(side)}>
                  {settings[side].name === 'Me'
                    ? 'My turn'
                    : `${settings[side].name || side.toUpperCase()}'s turn`}
                </button>
              </fieldset>
            ))}
            <label>
              Turn-taking
              <select
                value={settings.manualTurns ? 'manual' : 'auto'}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, manualTurns: e.target.value === 'manual' }))
                }
              >
                <option value="auto">Hands-free</option>
                <option value="manual">Manual · Spacebar</option>
              </select>
            </label>
            {!settings.manualTurns && (
              <label>
                Switch after{' '}
                <select
                  value={settings.switchAfterMs}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, switchAfterMs: Number(e.target.value) }))
                  }
                >
                  {[1000, 1500, 2500, 3500, 5000].map((ms) => (
                    <option key={ms} value={ms}>
                      {ms / 1000} s
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Bubbles on{' '}
              <select
                value={settings.placement}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, placement: e.target.value as 'speaker' | 'reader' }))
                }
              >
                <option value="speaker">Speaker's side</option>
                <option value="reader">Reader's side</option>
              </select>
            </label>
            {translatorPicker}
            <button
              className={`conversation-start ${speech.isListening ? 'is-listening' : ''}`}
              onClick={speech.isListening ? speech.stop : start}
              disabled={!speech.supported}
            >
              {speech.isListening ? 'Pause conversation' : 'Start conversation'}
            </button>
            <button
              onClick={() => {
                if (window.confirm('Clear the whole conversation?')) dispatch({ type: 'clear' });
              }}
            >
              Clear conversation
            </button>
            <button onClick={exportCsv}>Export CSV</button>
            <button onClick={() => fileInput.current?.click()}>Import CSV</button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="Import CSV file"
              hidden
              onChange={importCsv}
            />
          </>
        ) : (
          <>
            {onOpenLanguages && (
              <button type="button" className="conversation-langs-btn" onClick={onOpenLanguages}>
                Languages ({targetLangs.join(', ')})
              </button>
            )}
            {translatorPicker}
            <button
              type="button"
              className={`conversation-start ${lecture.speech.isListening ? 'is-listening' : ''}`}
              onClick={lecture.speech.isListening ? lecture.stop : lecture.start}
              disabled={!lecture.speech.supported}
            >
              {lecture.speech.isListening ? 'Pause lecture' : 'Start lecture'}
            </button>
            <button
              type="button"
              onClick={lecture.clear}
              disabled={lecture.entries.length === 0 && !lecture.speech.interim}
            >
              Clear lecture
            </button>
            <LectureFiles state={lectureState} onImport={value => {
              lecture.replace(value.entries);
              onSetLanguages?.(value.selectedLangs);
            }} />
            <SaveLectureToDriveControl
              state={lectureState}
              roomCode={activeRoomCode}
              className="inline-flex items-center gap-1.5"
              onSaved={(result: SaveLectureToDriveResult) => {
                setUiError('');
                setDriveStatus({
                  message: `${result.updatedExisting ? 'Updated' : 'Saved'} "${result.file.name}" in Google Drive (${result.folder.name}).`,
                  link: result.file.webViewLink,
                });
              }}
              onError={(msg) => {
                if (msg) setDriveStatus(null);
                setUiError(msg);
              }}
            />
            <OpenFromDriveButton
              className="inline-flex items-center gap-1.5"
              hasExistingEntries={() => lecture.entries.length > 0}
              onImport={(imported, file) => {
                setUiError('');
                lecture.replace(imported.entries);
                onSetLanguages?.(imported.selectedLangs);
                setDriveStatus({
                  message: `Opened "${file.name}" from Google Drive.`,
                });
              }}
              onError={(msg) => {
                if (msg) setDriveStatus(null);
                setUiError(msg);
              }}
            />
            <LecturePip state={lectureState} isDark={isDark} fontSize={fontSize}
              onAdjustFont={onAdjustFont ?? (() => {})} active={active && isLecture} />
            <label>
              Voice for
              <select
                aria-label="Playback language"
                value={effectiveLectureLang}
                onChange={(e) => setLecturePlaybackLang(e.target.value as ConversationLanguage)}
              >
                {lectureLangs.map((code) => (
                  <option key={code} value={code}>
                    {code === 'en' ? 'English' : LANGUAGE_MAP[code].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voice
              <VoiceSelect
                lang={effectiveLectureLang}
                ariaLabel="Voice"
                value={resolveVoiceId(effectiveLectureLang, voicePrefs)}
                onChange={(voiceId) => updateVoicePref(effectiveLectureLang, voiceId)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={lectureReadAloud}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setLectureReadAloud(checked);
                  if (checked) {
                    piperClient.unlockAudio();
                    const activeVoice = resolveVoiceId(effectiveLectureLang, voicePrefs);
                    if (activeVoice !== BROWSER_VOICE_ID) {
                      piperClient.preloadVoice(activeVoice);
                    }
                  }
                }}
              />
              Read aloud
            </label>
            <PlaybackToolbar
              status={lecturePlayback.status}
              downloadProgress={lecturePlayback.downloadProgress}
              onTogglePause={lecturePlayback.togglePause}
              onStop={lecturePlayback.stop}
            />
          </>
        )}
        <button type="button" onClick={() => setIsVoiceSettingsOpen(true)}>
          Voice settings
        </button>
        <button
          onClick={() => {
            if (fullscreen) void document.exitFullscreen();
            else
              void root.current
                ?.requestFullscreen?.()
                .catch(() => setUiError('Full screen is unavailable in this browser.'));
          }}
        >
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        {onAdjustFont && (
          <>
            <button aria-label="Smaller conversation text" onClick={() => onAdjustFont(-4)}>
              A−
            </button>
            <button aria-label="Larger conversation text" onClick={() => onAdjustFont(4)}>
              A+
            </button>
          </>
        )}
        {!isLecture && (
          <label>
            <input
              type="checkbox"
              checked={settings.readAloud}
              onChange={(e) => {
                const checked = e.target.checked;
                setSettings((s) => ({ ...s, readAloud: checked }));
                if (checked) {
                  piperClient.unlockAudio();
                  const voiceA = resolveVoiceId(settings.a.lang, voicePrefs);
                  const voiceB = resolveVoiceId(settings.b.lang, voicePrefs);
                  if (voiceA !== BROWSER_VOICE_ID) piperClient.preloadVoice(voiceA);
                  if (voiceB !== BROWSER_VOICE_ID) piperClient.preloadVoice(voiceB);
                } else {
                  twoWayPlayback.cancelAll();
                  speech.resume();
                }
              }}
            />
            Read aloud
          </label>
        )}
        <button type="button" className="conversation-exit" onClick={exit}>
          <span aria-hidden="true">← </span>Back to Listening Mode
        </button>
      </div>
      <TeacherRoomControls
        state={lectureState}
        visible={isLecture}
        onRoomCodeChange={setActiveRoomCode}
        onRestore={restored => {
          lecture.replace(restored.entries, { preserveIds: true });
          if (restored.selectedLangs.length > 0) onSetLanguages?.(restored.selectedLangs);
        }}
      />
      {isLecture ? (
        <>
          <p className="conversation-help">
            Continuous single-speaker English lecture mode. Live translations stream across columns
            as you speak and stay saved locally until cleared.
          </p>
          {packPanel}
          {driveStatus && (
            <p role="status" className="text-xs flex flex-wrap items-center gap-2">
              <span>{driveStatus.message}</span>
              {driveStatus.link && (
                <a
                  href={driveStatus.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open in Drive
                </a>
              )}
              <button
                type="button"
                onClick={() => setDriveStatus(null)}
                className="underline"
              >
                Dismiss
              </button>
            </p>
          )}
          {(uiError || lecture.uiError || lecture.speech.error || !lecture.speech.supported) && (
            <p role="alert">
              {uiError ||
                lecture.uiError ||
                lecture.speech.error ||
                'Speech recognition is unavailable. You can type a line below.'}
            </p>
          )}
          <LectureTranscript
            entries={lecture.entries}
            selectedLangs={targetLangs}
            fontSize={fontSize}
            isDark={isDark}
            isListening={lecture.speech.isListening}
            speechLocal={lecture.speech.speechLocal}
            interim={lecture.speech.interim}
            liveTranslations={lecture.liveTranslations}
            onAddLine={lecture.addLine}
            activePlayback={lecturePlayback.activePlayback}
            onPlayFrom={lecturePlayback.playFrom}
            onTogglePause={lecturePlayback.togglePause}
            onStopPlayback={lecturePlayback.stop}
          />
        </>
      ) : (
        <>
          <p className="conversation-help">
            Each message uses the current speaker’s name.{' '}
            {settings.manualTurns
              ? 'Press Space or click Next speaker to pass the turn.'
              : 'Pause to send and pass the turn.'}{' '}
            Use ⇄ to correct a speaker. Left Shift: {settings.a.name}; Right Shift: {settings.b.name}.
          </p>
          {packPanel}
          {(uiError || speech.error || !speech.supported) && (
            <p role="alert">
              {uiError ||
                speech.error ||
                'Speech recognition is unavailable. You can type messages below.'}
            </p>
          )}
          <div
            className="conversation-thread"
            ref={thread}
            role="log"
            aria-label="Conversation messages"
            onScroll={() => {
              const el = thread.current!;
              following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              if (following.current) setNewMessage(false);
            }}
          >
            {!messages.length && (
              <p className="conversation-empty">
                Start a conversation or type a message. Messages stay here until you clear them.
              </p>
            )}
            {messages.map(renderMessage)}
            {(speech.draft || speech.interim) && (
              <article className={`conversation-bubble side-${speech.turn}`}>
                <small>{settings[speech.turn].name} · speaking…</small>
                <div
                  dir={direction(settings[speech.turn].lang)}
                  style={{
                    fontSize,
                    ...captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark),
                  }}
                >
                  {[speech.draft, speech.interim].filter(Boolean).join(' ')}
                </div>
              </article>
            )}
          </div>
          {newMessage && (
            <button
              className="conversation-new"
              onClick={() => {
                following.current = true;
                if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
                setNewMessage(false);
              }}
            >
              ↓ New message
            </button>
          )}
          <footer>
            <div
              role="status"
              className={`conversation-listening ${speech.isListening ? 'conversation-pulse' : ''}`}
              style={
                speech.isListening
                  ? captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark)
                  : undefined
              }
            >
              {speech.isListening
                ? `Listening for ${settings[speech.turn].name}…`
                : 'Conversation stopped'}{' '}
              {speech.isListening && <small>🎙 {speech.speechLocal ? 'local' : 'cloud'}</small>}
            </div>
            {settings.manualTurns && speech.isListening && (
              <button
                type="button"
                ref={nextButton}
                className="conversation-next-speaker conversation-start"
                aria-keyshortcuts="Space"
                onClick={() => speech.setTurn(otherSide(speech.turn))}
              >
                Next speaker · {settings[otherSide(speech.turn)].name} <kbd>Space</kbd>
              </button>
            )}
            <details>
              <summary>Type a message</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(sender, text);
                  setText('');
                }}
              >
                <select
                  aria-label="Message sender"
                  value={sender}
                  onChange={(e) => setSender(e.target.value as Side)}
                >
                  <option value="a">{settings.a.name}</option>
                  <option value="b">{settings.b.name}</option>
                </select>
                <input
                  aria-label="Message text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type and press Enter"
                />
                <button disabled={!text.trim()}>Send</button>
              </form>
            </details>
          </footer>
        </>
      )}
      <VoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
        isDark={isDark}
      />
    </div>
  );
}
