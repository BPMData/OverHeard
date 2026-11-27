import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_LANGUAGES } from '../constants';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { MicBlock } from '../micPermission';
import type { PackProgress } from '../onDevice';
import type { LectureEntry } from '../conversation/lectureState';
import type { ConversationSubMode } from './conversationSettings';
import {
  bothWays,
  fromEnglish,
  needOnlineText,
  useLanguagesNeedingOnline,
} from '../translation/useLanguagesNeedingOnline';
import { useWakeLock } from '../wakeLock';
import { useLectureWorkspace } from '../conversation/useLectureWorkspace';
import { useTwoWayWorkspace } from '../conversation/useTwoWayWorkspace';
import { piperClient } from '../tts/piperClient';
import { BROWSER_VOICE_ID, useVoicePreferences } from '../tts/voices';
import { AboutModal } from './AboutModal';
import { ConversationToolbar } from './ConversationToolbar';
import { LectureToolbar } from './LectureToolbar';
import { LectureView } from './LectureView';
import { TwoWayView } from './TwoWayView';
import { FaceToFaceView } from './FaceToFaceView';
import { VoiceSettingsModal } from './VoiceSettingsModal';
import { LectureControlsSetting } from './LectureControlsSetting';
import { useConversationSettings } from './useConversationSettings';
import './ConversationMode.css';
import { setReportContext } from '../report/diagnostics';

export interface ConversationModeProps {
  active: boolean;
  fontSize: number;
  isDark: boolean;
  onToggleDark?: () => void;
  /** `live` marks text still being spoken: it only uses this device or the free translator */
  translate: (
    text: string,
    target: ConversationLanguage,
    source: ConversationLanguage,
    options?: { live?: boolean }
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
  onDeviceTranslationFailing?: boolean;
  onAdjustFont?: (delta: number) => void;
  permissionBanner?: React.ReactNode;
  /** Receives on-device download progress, for the panel below */
  onPackProgress?: PackProgress;
  /** The on-device download progress panel (renders nothing when idle) */
  packPanel?: React.ReactNode;
  /** Lecture imported from the base web-page */
  importedLecture?: { seq: number; entries: LectureEntry[] } | null;
  /** The view that `onExit` returns to, named on the exit button */
  returnView?: 'columns' | 'subtitle';
}
export function ConversationMode({
  active,
  fontSize,
  isDark,
  onToggleDark,
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
  onDeviceTranslationFailing = false,
  onAdjustFont,
  permissionBanner,
  onPackProgress,
  packPanel,
  importedLecture,
  returnView = 'columns',
}: ConversationModeProps) {
  const [settings, setSettings] = useConversationSettings(initialLanguage);
  const showAllControls = settings.alwaysShowAllLectureControls || settings.showAllLectureControls;
  const targetLangs: LanguageCode[] = selectedLangs
    ? selectedLangs
    : initialLanguage && initialLanguage !== 'en'
      ? [initialLanguage]
      : DEFAULT_LANGUAGES;
  const isLecture = settings.mode === 'lecture';
  const faceToFace = !isLecture && settings.layout === 'face-to-face';
  // Face to face keeps the screen for the two halves; the toolbar opens on request
  const [controlsOpen, setControlsOpen] = useState(false);
  // Every place a language is chosen says which ones "Only on this device" can't translate
  const needOnline = useLanguagesNeedingOnline(
    isLecture ? fromEnglish(targetLangs) : bothWays(settings.a.lang, settings.b.lang),
    mtPreference === 'on-device' && active
  );
  const needOnlineNotice = needOnlineText(needOnline, { rooms: isLecture });
  const [fullscreen, setFullscreen] = useState(false);
  const [uiError, setUiError] = useState('');
  const [voicePrefs, persistVoicePref] = useVoicePreferences();
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const updateVoicePref = useCallback(
    (lang: ConversationLanguage, voiceId: string) => {
      persistVoicePref(lang, voiceId);
      if (voiceId !== BROWSER_VOICE_ID) {
        piperClient.preloadVoice(voiceId);
      }
    },
    [persistVoicePref]
  );
  const lectureWorkspace = useLectureWorkspace({
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
  });
  const { lecture, lecturePlayback, driveStatus, setDriveStatus, stopLectureWorkspace } = lectureWorkspace;
  const twoWayWorkspace = useTwoWayWorkspace({
    active,
    translate,
    mtPreference,
    onStartAttempt,
    onPermissionDenied,
    onPackProgress,
    settings,
    voicePrefs,
    setUiError,
  });
  const {
    messages,
    onCorrectMessage,
    sender,
    setSender,
    text,
    setText,
    newMessage,
    setNewMessage,
    thread,
    nextButton,
    following,
    send,
    speech,
    twoWayPlayback,
    startFrom,
    stopTwoWayWorkspace,
  } = twoWayWorkspace;
  // Feature status for "Something not working?" reports
  const reportListening = isLecture ? lectureWorkspace.lecture.speech.isListening : speech.isListening;
  useEffect(() => {
    if (active) setReportContext({ view: isLecture ? 'Lecture' : 'Two-way', listening: reportListening });
  }, [active, isLecture, reportListening]);
  useWakeLock(active);
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
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const stopConversationAndCleanup = () => {
    stopTwoWayWorkspace();
    stopLectureWorkspace();
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
    stopTwoWayWorkspace();
    stopLectureWorkspace();
    setUiError('');
    lecture.setUiError('');
    setSettings((s) => ({ ...s, mode: nextMode }));
  };
  const toggleFullscreen = () => {
    if (fullscreen) void document.exitFullscreen();
    else
      void root.current?.requestFullscreen?.().catch(() => setUiError('Full screen is unavailable in this browser.'));
  };
  const returnViewName = returnView === 'subtitle' ? 'Subtitle' : 'Columns';
  return (
    <div
      ref={root}
      className={`conversation-mode ${isDark ? 'conversation-dark' : ''} ${faceToFace ? 'is-face-to-face' : ''}`}
      hidden={!active}
    >
      {permissionBanner}
      <ConversationToolbar
        {...lectureWorkspace}
        {...twoWayWorkspace}
        settings={settings}
        setSettings={setSettings}
        voicePrefs={voicePrefs}
        updateVoicePref={updateVoicePref}
        targetLangs={targetLangs}
        showAllControls={showAllControls}
        isLecture={isLecture}
        faceToFace={faceToFace}
        controlsOpen={controlsOpen}
        goHome={goHome}
        exit={exit}
        switchSubMode={switchSubMode}
        fullscreen={fullscreen}
        toggleFullscreen={toggleFullscreen}
        onOpenLanguages={onOpenLanguages}
        onAdjustFont={onAdjustFont}
        onToggleDark={onToggleDark}
        isDark={isDark}
        translatorPicker={translatorPicker}
        setIsVoiceSettingsOpen={setIsVoiceSettingsOpen}
        setIsGuideOpen={setIsGuideOpen}
        returnViewName={returnViewName}
      />
      {needOnline.length > 0 ? (
        <p className="lecture-translator-warning" role="alert" title={needOnlineNotice.title}>
          ⚠ {needOnlineNotice.names}: “Only on this device” can’t translate{' '}
          {needOnline.length > 1 ? 'these languages' : 'this language'}, so{' '}
          {needOnline.length > 1 ? 'they stay' : 'it stays'} untranslated on this screen
          {isLecture ? ` (students in a live room still get ${needOnline.length > 1 ? 'them' : 'it'} online)` : ''}.
          {isLecture && !showAllControls
            ? ' Open all controls and choose On-device first or an online translator.'
            : ' Choose On-device first or an online translator.'}
        </p>
      ) : (
        mtPreference === 'on-device' &&
        onDeviceTranslationFailing && (
          <p className="lecture-translator-warning" role="alert">
            On-device translation failed. “Only on this device” never uses online translators, so these lines stay
            untranslated.
            {isLecture && !showAllControls
              ? ' Open all controls to choose another translator.'
              : ' Choose On-device first or an online translator.'}
          </p>
        )
      )}
      <LectureToolbar
        {...lectureWorkspace}
        active={active}
        isLecture={isLecture}
        showAllControls={showAllControls}
        settings={settings}
        setSettings={setSettings}
        onSetLanguages={onSetLanguages}
        translatorPicker={translatorPicker}
        isDark={isDark}
        fontSize={fontSize}
        onAdjustFont={onAdjustFont}
        voicePrefs={voicePrefs}
        updateVoicePref={updateVoicePref}
        setUiError={setUiError}
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
      ) : faceToFace ? (
        <FaceToFaceView
          settings={settings}
          speech={speech}
          messages={messages}
          onCorrectMessage={onCorrectMessage}
          onToggleManualTurns={() => setSettings((s) => ({ ...s, manualTurns: !s.manualTurns }))}
          fontSize={fontSize}
          isDark={isDark}
          packPanel={packPanel}
          uiError={uiError}
          onStart={startFrom}
          onAdjustFont={onAdjustFont}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          controlsOpen={controlsOpen}
          onToggleControls={() => setControlsOpen((open) => !open)}
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
          onCorrectMessage={onCorrectMessage}
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
        showPrivacy
      >
        <LectureControlsSetting initialLanguage={initialLanguage} />
      </VoiceSettingsModal>
      <AboutModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </div>
  );
}
