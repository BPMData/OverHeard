import { useState } from 'react';
import { LectureTranscript } from '../components/LectureTranscript';
import { WhiteboatIcon } from '../components/WhiteboatIcon';
import { SUPPORTED_LANGUAGES } from '../constants';
import { prepareOnDeviceTranslators } from '../onDevice';
import type { LanguageCode } from '../types';
import { LecturePip } from './LecturePip';
import { useStudentRoom } from './useStudentRoom';
import { useStudentTranslations } from './useStudentTranslations';
import { emptyLecture, normalizeRoomCode, validRoomCode } from './protocol';
import '../components/ConversationMode.css';

export function JoinRoomForm() {
  const [code, setCode] = useState('');
  return <form className="room-join" onSubmit={event => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!validRoomCode(normalized)) return;
    const url = new URL(window.location.href); url.search = ''; url.searchParams.set('room', normalized);
    window.location.assign(url.href);
  }}>
    <input aria-label="Room code to join" placeholder="Student room code" value={code} maxLength={40}
      onChange={event => setCode(event.target.value)} />
    <button type="submit" disabled={!validRoomCode(normalizeRoomCode(code))}>Join room</button>
  </form>;
}

export function StudentRoom({ code }: { code: string }) {
  const { snapshot, connected, error } = useStudentRoom(code);
  const [language, setLanguage] = useState<LanguageCode | 'en'>('en');
  const [fontSize, setFontSize] = useState(28);
  const [isDark, setIsDark] = useState(false);
  const translations = useStudentTranslations(snapshot, language);
  const state = { ...(snapshot || emptyLecture()), entries: translations.entries,
    selectedLangs: language === 'en' ? [] : [language],
    interim: connected ? snapshot?.interim || '' : '',
    liveTranslations: connected ? translations.liveTranslations : {},
    isListening: connected && !!snapshot?.teacherOnline && !!snapshot?.isListening && !snapshot?.ended };
  const adjustFont = (delta: number) => setFontSize(value => Math.min(56, Math.max(20, value + delta)));
  return <main className={`conversation-mode ${isDark ? 'conversation-dark' : ''}`}>
    <div className="conversation-settings">
      <span className="conversation-brand"><WhiteboatIcon app="overheard" size={22} /> OverHeard</span>
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
      <LecturePip state={state} isDark={isDark} fontSize={fontSize} onAdjustFont={adjustFont} />
      <button type="button" aria-label="Smaller text" onClick={() => adjustFont(-4)}>A−</button>
      <button type="button" aria-label="Larger text" onClick={() => adjustFont(4)}>A+</button>
      <button type="button" onClick={() => setIsDark(value => !value)}>{isDark ? 'Light theme' : 'Dark theme'}</button>
      <a href={window.location.pathname}>Leave room</a>
    </div>
    <p className="conversation-help">Follow your teacher’s captions in your language. Pop them out to keep reading while you work.</p>
    <p aria-live="polite">{error || (snapshot?.ended ? 'This lecture has ended.' : !snapshot?.teacherOnline
      ? 'Teacher disconnected. Waiting for them to reconnect…' : state.isListening ? 'Connected · Lecture live' : 'Connected · Teacher paused')}</p>
    {error && !snapshot && <JoinRoomForm />}
    {translations.hasFailures && <button type="button" onClick={translations.retry}>Retry unavailable translations</button>}
    <LectureTranscript entries={state.entries} selectedLangs={state.selectedLangs} fontSize={fontSize} isDark={isDark}
      isListening={state.isListening} speechLocal={null} interim={state.interim} liveTranslations={state.liveTranslations} />
  </main>;
}
