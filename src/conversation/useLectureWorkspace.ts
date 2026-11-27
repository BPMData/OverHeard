import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useOnline } from '../app/useOnline';
import { useLectureMode } from './useLectureMode';
import { useLecturePlayback } from '../tts/useSpeechPlayback';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { ConversationModeProps } from '../components/ConversationMode';
import type { ConversationSettings } from '../components/conversationSettings';
import type { Dispatch, SetStateAction } from 'react';
import type { VoicePreferences } from '../tts/voices';

type Shared = Pick<
  ConversationModeProps,
  'active' | 'translate' | 'mtPreference' | 'onStartAttempt' | 'onPermissionDenied' | 'onPackProgress'
> & {
  settings: ConversationSettings;
  voicePrefs: VoicePreferences;
};

type Options = Shared & {
  targetLangs: LanguageCode[];
  showAllControls: boolean;
  setSettings: Dispatch<SetStateAction<ConversationSettings>>;
  importedLecture: ConversationModeProps['importedLecture'];
};
export function useLectureWorkspace({
  active,
  translate,
  mtPreference,
  onStartAttempt,
  onPermissionDenied,
  onPackProgress,
  settings,
  setSettings,
  voicePrefs,
  targetLangs,
  showAllControls,
  importedLecture,
}: Options) {
  const isLecture = settings.mode === 'lecture';
  const [driveStatus, setDriveStatus] = useState<{ message: string; link?: string } | null>(null);
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [shareSetupOpen, setShareSetupOpen] = useState(false);
  const online = useOnline();
  const lastImportedSeq = useRef(0);
  const roomControlsId = useId();
  const roomCodeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (shareSetupOpen) roomCodeRef.current?.focus();
  }, [shareSetupOpen]);
  const lectureToolsId = useId();
  // Simple controls hide Clear lecture until the teacher ends the room, so a live class
  // can't be wiped by accident but the next class can start from an empty transcript.
  const [roomJustEnded, setRoomJustEnded] = useState(false);
  const previousRoomCode = useRef<string | null>(null);
  const handleRoomCodeChange = useCallback((code: string | null) => {
    setRoomJustEnded(!code && previousRoomCode.current !== null);
    previousRoomCode.current = code;
    setActiveRoomCode(code);
    if (code) setShareSetupOpen(false);
  }, []);
  const [lecturePlaybackLang, setLecturePlaybackLang] = useState<ConversationLanguage>(() => targetLangs[0] ?? 'en');
  const [lectureReadAloud, setLectureReadAloud] = useState(false);
  const lecture = useLectureMode({
    active: active && isLecture,
    selectedLangs: targetLangs,
    mtPreference,
    translate,
    onStartAttempt,
    onPermissionDenied,
    onPackProgress,
  });
  const translateLiveSpeech = useCallback(
    (text: string, lang: ConversationLanguage) => translate(text, lang, 'en', { live: true }),
    [translate]
  );
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
    live: settings.lectureLiveReadAloud
      ? { interim: lecture.speech.interim, translate: translateLiveSpeech, suspendSpeech: false }
      : null,
  });
  const wasLecturePlaying = useRef(false);
  useEffect(() => {
    const isPlaybackActive = lecturePlayback.status === 'playing' || lecturePlayback.status === 'downloading';
    if (isPlaybackActive) {
      wasLecturePlaying.current = true;
    } else if (wasLecturePlaying.current) {
      wasLecturePlaying.current = false;
      lecture.speech.resume();
    }
  }, [lecturePlayback.status, lecture.speech.resume]);
  const lectureState = {
    entries: lecture.entries,
    selectedLangs: targetLangs,
    interim: active && isLecture ? lecture.speech.interim : '',
    liveTranslations: lecture.liveTranslations,
    isListening: active && isLecture && lecture.speech.isListening,
  };
  useEffect(() => {
    if (!importedLecture || importedLecture.seq === lastImportedSeq.current) return;
    lastImportedSeq.current = importedLecture.seq;
    setSettings((s) => (s.mode === 'lecture' ? s : { ...s, mode: 'lecture' }));
    lecture.replace(importedLecture.entries, { preserveIds: true });
  }, [importedLecture, lecture.replace]);
  const startLecture = () => {
    // Simple controls normally start from a room, but rooms need the server, so offline
    // the lecture runs on this device only.
    if (!showAllControls && !activeRoomCode && online) {
      if (shareSetupOpen) roomCodeRef.current?.focus();
      else setShareSetupOpen(true);
      return;
    }
    lecture.start();
  };
  const stopLectureWorkspace = () => {
    lecture.stop();
    lecturePlayback.stop();
  };
  return {
    lecture,
    lectureState,
    lecturePlayback,
    lectureLangs,
    effectiveLectureLang,
    lecturePlaybackLang,
    setLecturePlaybackLang,
    lectureReadAloud,
    setLectureReadAloud,
    activeRoomCode,
    shareSetupOpen,
    setShareSetupOpen,
    roomJustEnded,
    handleRoomCodeChange,
    roomControlsId,
    lectureToolsId,
    roomCodeRef,
    driveStatus,
    setDriveStatus,
    startLecture,
    stopLectureWorkspace,
    online,
  };
}
