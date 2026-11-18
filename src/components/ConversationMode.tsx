import { useWakeLock } from '../wakeLock';
import { withMicAccess, type MicBlock } from '../micPermission';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DEFAULT_LANGUAGES, SUPPORTED_LANGUAGES } from '../constants';
import type { ConversationLanguage, LanguageCode } from '../types';
import {
  createMessage,
  messagesReducer,
  otherSide,
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
  conversationJson,
  loadConversationSettings,
  parseConversationJson,
  saveConversationSettings,
  type ConversationSubMode,
} from './conversationSettings';
import { AboutModal } from './AboutModal';
import { LectureSettings, LectureView } from './LectureView';
import { TwoWayReadAloud, TwoWaySettings, TwoWayView } from './TwoWayView';
import { VoiceSettingsModal, type GeminiRefineSettings } from './VoiceSettingsModal';
import { WhiteboatIcon } from './WhiteboatIcon';
import { HelpCircle, Volume2 } from 'lucide-react';
import './ConversationMode.css';
import { TeacherRoomControls } from '../rooms/TeacherRoomControls';
import { piperClient } from '../tts/piperClient';
import { useLecturePlayback, useTwoWayPlayback } from '../tts/useSpeechPlayback';
import {
  BROWSER_VOICE_ID,
  resolveVoiceId,
  useVoicePreferences,
} from '../tts/voices';
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
  onHome?: () => void;
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
  geminiRefine?: GeminiRefineSettings;
}
export function ConversationMode({
  active,
  fontSize,
  isDark,
  translate,
  onExit,
  onHome,
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
  geminiRefine,
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
  const [isGuideOpen, setIsGuideOpen] = useState(false);
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
  const translateLiveSpeech = useCallback(
    (text: string, lang: ConversationLanguage) => translate(text, lang, 'en'),
    [translate],
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
  const stopConversationAndCleanup = () => {
    speech.stop();
    lecture.stop();
    twoWayPlayback.cancelAll();
    lecturePlayback.stop();
    if (document.fullscreenElement === root.current) void document.exitFullscreen();
  };
  const exit = () => {
    stopConversationAndCleanup();
    onExit();
  };
  const goHome = () => {
    stopConversationAndCleanup();
    if (onHome) onHome();
    else onExit();
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
  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([conversationJson(messages, settings)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content =
        typeof file.text === 'function' ? await file.text() : await new Response(file).text();
      const imported = parseConversationJson(content, settings);
      setUiError('');
      imported.forEach((m) => {
        if (m.status === 'done') spoken.current.add(`${m.id}:${m.revision}`);
      });
      dispatch({ type: 'import', messages: imported });
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Could not import JSON.');
    }
  };
  return (
    <div
      ref={root}
      className={`conversation-mode ${isDark ? 'conversation-dark' : ''}`}
      hidden={!active}
    >
      {permissionBanner}
      <div className="conversation-settings">
        <button
          type="button"
          className="conversation-brand"
          onClick={goHome}
          aria-label="OverHeard — Go to Columns view"
          title="Back to main Columns view"
        >
          <WhiteboatIcon app="overheard" size={22} />
          <span>OverHeard</span>
        </button>
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
        {isLecture ? (
          <LectureSettings
            active={active && isLecture}
            targetLangs={targetLangs}
            onOpenLanguages={onOpenLanguages}
            onSetLanguages={onSetLanguages}
            translatorPicker={translatorPicker}
            lecture={lecture}
            lectureState={lectureState}
            isDark={isDark}
            fontSize={fontSize}
            onAdjustFont={onAdjustFont}
            activeRoomCode={activeRoomCode}
            setUiError={setUiError}
            setDriveStatus={setDriveStatus}
            effectiveLectureLang={effectiveLectureLang}
            setLecturePlaybackLang={setLecturePlaybackLang}
            lectureLangs={lectureLangs}
            voicePrefs={voicePrefs}
            updateVoicePref={updateVoicePref}
            lectureReadAloud={lectureReadAloud}
            setLectureReadAloud={setLectureReadAloud}
            settings={settings}
            setSettings={setSettings}
            lecturePlayback={lecturePlayback}
          />
        ) : (
          <TwoWaySettings
            settings={settings}
            setSettings={setSettings}
            speech={speech}
            voicePrefs={voicePrefs}
            updateVoicePref={updateVoicePref}
            translatorPicker={translatorPicker}
            start={start}
            onClear={() => dispatch({ type: 'clear' })}
            exportJson={exportJson}
            importJson={importJson}
            fileInput={fileInput}
          />
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5"
          onClick={() => setIsVoiceSettingsOpen(true)}
          title="Open voice and translation refinement settings"
        >
          <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Settings</span>
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
          <TwoWayReadAloud
            settings={settings}
            setSettings={setSettings}
            voicePrefs={voicePrefs}
            speech={speech}
            twoWayPlayback={twoWayPlayback}
          />
        )}
        <span className="inline-flex items-center gap-2" style={{ marginLeft: 'auto' }}>
          <button type="button" className="conversation-exit" onClick={exit}>
            <span aria-hidden="true">← </span>Back to Listening Mode
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5"
            onClick={() => setIsGuideOpen(true)}
            aria-label="How to use OverHeard: Guide, FAQ, and Privacy"
            title="How to use OverHeard: Guide, FAQ, and Privacy Notice"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Guide &amp; FAQ</span>
          </button>
        </span>
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
        <LectureView
          packPanel={packPanel}
          driveStatus={driveStatus}
          setDriveStatus={setDriveStatus}
          uiError={uiError}
          lecture={lecture}
          targetLangs={targetLangs}
          fontSize={fontSize}
          isDark={isDark}
          lecturePlayback={lecturePlayback}
        />
      ) : (
        <TwoWayView
          settings={settings}
          speech={speech}
          twoWayPlayback={twoWayPlayback}
          fontSize={fontSize}
          isDark={isDark}
          packPanel={packPanel}
          uiError={uiError}
          thread={thread}
          following={following}
          messages={messages}
          onCorrectMessage={(message) => dispatch({ type: 'correct', message })}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          nextButton={nextButton}
          send={send}
          sender={sender}
          setSender={setSender}
          text={text}
          setText={setText}
        />
      )}
      <VoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
        isDark={isDark}
        geminiRefine={geminiRefine}
      />
      <AboutModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}
