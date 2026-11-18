/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SpeechDebugPanel } from './speechDebug';
import { useCaptionTranscript } from './captions/useCaptionTranscript';
import { useCaptionSpeech } from './speech/useCaptionSpeech';
import { useState, useRef, useCallback } from 'react';
import { MAX_LANGUAGES } from './constants';
import type { ConversationLanguage, LanguageCode } from './types';
import { translateConversationMessage } from './conversation/translateMessage';
import { saveLectureEntries, type LectureEntry } from './conversation/lectureState';
import { ConversationMode } from './components/ConversationMode';
import { loadConversationSettings, saveConversationSettings } from './components/conversationSettings';
import { LanguageModal } from './components/LanguageModal';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { useServerConfig } from './translation/useServerConfig';
import { useTranslator } from './translation/useTranslator';
import { AboutModal } from './components/AboutModal';
import { PackProgressPanel } from './components/PackProgressPanel';
import { PipSubtitlePortal } from './components/PipSubtitlePortal';

import { useBrowserSupport } from './app/useBrowserSupport';
import { usePackProgress } from './app/usePackProgress';
import { usePipWindow } from './pip/usePipWindow';

import { useAppSettings } from './app/useAppSettings';
import { AppBanners } from './app/AppBanners';
import { PermissionBanner } from './app/PermissionBanner';
import { useColumnPlayback } from './captions/useColumnPlayback';
import { ColumnsView } from './captions/ColumnsView';
import { SubtitleBar } from './captions/SubtitleBar';
import { AppHeader } from './header/AppHeader';
import { TranslatorPicker } from './header/TranslatorPicker';
import { useCaptionHotkey } from './speech/useCaptionHotkey';

export default function App() {
  const {
    selectedLangs, setSelectedLangs, selectedLangsRef, subtitleLang, setSubtitleLang,
    fontSize, handleAdjustFont, handleToggleLanguage, displayMode, setDisplayMode,
    showPreviousLine, setShowPreviousLine,
  } = useAppSettings();
  const [conversationVisited, setConversationVisited] = useState(false);
  const previousMode = useRef<'columns' | 'subtitle'>('columns');
  const { columnPlayback, speakColumnTranslation, stopColumnPlayback } = useColumnPlayback(displayMode);

  // Modals & drawers
  const [isLangModalOpen, setIsLangModalOpen] = useState<boolean>(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState<boolean>(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState<boolean>(false);
  const [isTestBarOpen, setIsTestBarOpen] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');
  const [importedLecture, setImportedLecture] = useState<{ seq: number; entries: LectureEntry[] } | null>(null);
  const importSeqRef = useRef<number>(0);

  // Speech recognition & permission states
  const [micPermissionDenied, setMicPermissionDenied] = useState<boolean>(false);
  const [micInsecure, setMicInsecure] = useState(false);

  const {
    availableProviders, refineEnabledRef, serverRefineAvailable, serverRefineStatus,
    geminiRefineEnabled, geminiRefineEnabledRef, setGeminiRefineEnabled,
  } = useServerConfig(isVoiceSettingsOpen);
  const {
    effectiveMtPreference, setMtPreference, mtPreferenceRef, onDeviceSupported,
    lastUsedProvider, lastTranslateMs, fetchMT, fetchTranslationWithRetry, getMtProvider,
  } = useTranslator(availableProviders);

  const { packProgress, packStartedAt, reportPack } = usePackProgress();

  const { isSupportedBrowser, hasSpeechApi, setHasSpeechApi, hasPipApi, isEmbeddedIframe } = useBrowserSupport();
  const {
    pipWindow, pipNotice, setPipNotice, visiblePipLines, pipLayout, setPipLayout, isDark, setIsDark,
    handleTogglePip, handleTogglePipLine, closePip, closePipForConversation,
  } = usePipWindow(selectedLangs, isEmbeddedIframe);

  const {
    segments, currentSegment, previousSegment, handleFinalizedPhrase,
    interimTranscript, setInterimTranscript, clearLiveTranslation, liveTranslations,
    confirmClear, setConfirmClear, handleClearConfirm, handleExportJson,
    manualInput, setManualInput, handleManualSubmit, handleBurstTest,
  } = useCaptionTranscript({
    selectedLangs, selectedLangsRef, stopColumnPlayback, fetchMT, getMtProvider,
    fetchTranslationWithRetry, mtPreferenceRef, refineEnabledRef, geminiRefineEnabledRef,
  });

  const { isListening, speechIsLocal, speechStatusNotice, stopListening, toggleListening } = useCaptionSpeech({
    onFinal: handleFinalizedPhrase, onInterim: setInterimTranscript, clearLiveTranslation,
    onPermissionChange: setMicPermissionDenied, setMicInsecure, setHasSpeechApi,
    mtPreferenceRef, selectedLangsRef, reportPack,
  });

  useCaptionHotkey(displayMode, toggleListening);

  const translateConversation = useCallback(
    (text: string, target: ConversationLanguage, source: ConversationLanguage) =>
      translateConversationMessage(text, target, source, fetchMT),
    [fetchMT]
  );

  const applyImportedLecture = useCallback(
    (imported: { entries: LectureEntry[]; selectedLangs: LanguageCode[] }) => {
      setImportError('');
      saveLectureEntries(imported.entries);
      saveConversationSettings({
        ...loadConversationSettings(selectedLangs[0] ?? 'es'),
        mode: 'lecture',
      });
      if (imported.selectedLangs.length > 0) {
        setSelectedLangs(imported.selectedLangs.slice(0, MAX_LANGUAGES));
      }
      if (displayMode !== 'conversation') {
        previousMode.current = displayMode;
      }
      stopListening();
      closePipForConversation();
      setMicPermissionDenied(false);
      setImportedLecture({ seq: ++importSeqRef.current, entries: imported.entries });
      setConversationVisited(true);
      setDisplayMode('conversation');
    },
    [displayMode, closePipForConversation, selectedLangs, stopListening],
  );

  const enterConversation = () => {
    if (displayMode === 'conversation') return;
    previousMode.current = displayMode;
    stopListening();
    closePipForConversation();
    setMicPermissionDenied(false);
    setConversationVisited(true);
    setDisplayMode('conversation');
  };

  const permissionBanner = micPermissionDenied && (
    <PermissionBanner
      displayMode={displayMode} isEmbeddedIframe={isEmbeddedIframe} micInsecure={micInsecure}
    />
  );
  const translatorPicker = (
    <TranslatorPicker
      displayMode={displayMode} selectedLangs={selectedLangs}
      onDeviceSupported={onDeviceSupported} speechIsLocal={speechIsLocal}
      lastTranslateMs={lastTranslateMs} lastUsedProvider={lastUsedProvider}
      availableProviders={availableProviders} effectiveMtPreference={effectiveMtPreference}
      setMtPreference={setMtPreference} reportPack={reportPack}
    />
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#090D16] text-[#0F172A] dark:text-[#F8FAFC] transition-colors">
      <SpeechDebugPanel />
      <AppBanners
        displayMode={displayMode} isEmbeddedIframe={isEmbeddedIframe} hasSpeechApi={hasSpeechApi}
        isSupportedBrowser={isSupportedBrowser} importError={importError} pipNotice={pipNotice}
        permissionBanner={permissionBanner} setImportError={setImportError}
        setPipNotice={setPipNotice}
      />
      {displayMode !== 'conversation' && (
        <>
          <AppHeader
            selectedLangs={selectedLangs} isDark={isDark} hasPipApi={hasPipApi}
            showPreviousLine={showPreviousLine} isTestBarOpen={isTestBarOpen}
            packProgress={packProgress} packStartedAt={packStartedAt} segments={segments}
            pipWindow={pipWindow} speechStatusNotice={speechStatusNotice}
            translatorPicker={translatorPicker} applyImportedLecture={applyImportedLecture}
            setIsDark={setIsDark} setIsTestBarOpen={setIsTestBarOpen}
            setShowPreviousLine={setShowPreviousLine} setDisplayMode={setDisplayMode}
            handleTogglePip={handleTogglePip} setImportError={setImportError}
            setIsVoiceSettingsOpen={setIsVoiceSettingsOpen}
            setIsLangModalOpen={setIsLangModalOpen} setIsAboutModalOpen={setIsAboutModalOpen}
            handleExportJson={handleExportJson}
            listen={{ isListening, toggleListening }}
            sizing={{ fontSize, handleAdjustFont }}
            modes={{ displayMode, setDisplayMode, enterConversation }}
            clear={{ confirmClear, segments, interimTranscript, setConfirmClear, handleClearConfirm }}
            testInput={{ manualInput, setManualInput, handleManualSubmit, handleFinalizedPhrase, handleBurstTest }}
          />
          {displayMode === 'columns' ? (
            <ColumnsView
              selectedLangs={selectedLangs} isListening={isListening} isDark={isDark}
              showPreviousLine={showPreviousLine} fontSize={fontSize}
              currentSegment={currentSegment} previousSegment={previousSegment}
              liveTranslations={liveTranslations} interimTranscript={interimTranscript}
              columnPlayback={columnPlayback} speakColumnTranslation={speakColumnTranslation}
              stopColumnPlayback={stopColumnPlayback}
            />
          ) : (
            <SubtitleBar
              selectedLangs={selectedLangs} subtitleLang={subtitleLang} isListening={isListening}
              isDark={isDark} hasPipApi={hasPipApi} showPreviousLine={showPreviousLine}
              fontSize={fontSize} currentSegment={currentSegment}
              previousSegment={previousSegment} segments={segments}
              liveTranslations={liveTranslations} pipWindow={pipWindow}
              interimTranscript={interimTranscript} setSubtitleLang={setSubtitleLang}
              handleTogglePip={handleTogglePip}
            />
          )}
        </>
      )}
      {conversationVisited && (
        <ConversationMode
          active={displayMode === 'conversation'}
          fontSize={fontSize}
          onAdjustFont={handleAdjustFont}
          isDark={isDark}
          translate={translateConversation}
          initialLanguage={selectedLangs[0] ?? 'es'}
          selectedLangs={selectedLangs}
          onOpenLanguages={() => setIsLangModalOpen(true)}
          onSetLanguages={setSelectedLangs}
          mtPreference={effectiveMtPreference}
          translatorPicker={translatorPicker}
          permissionBanner={permissionBanner}
          onPackProgress={reportPack}
          packPanel={<PackProgressPanel progress={packProgress} startedAt={packStartedAt} />}
          importedLecture={importedLecture}
          onStartAttempt={() => setMicPermissionDenied(false)}
          onPermissionDenied={(reason) => {
            setMicInsecure(reason === 'insecure');
            setMicPermissionDenied(true);
          }}
          onExit={() => {
            setMicPermissionDenied(false);
            setDisplayMode(previousMode.current);
          }}
          onHome={() => {
            setMicPermissionDenied(false);
            setDisplayMode('columns');
          }}
          geminiRefine={{
            enabled: geminiRefineEnabled,
            onChange: setGeminiRefineEnabled,
            serverAvailable: serverRefineAvailable,
            serverStatus: serverRefineStatus,
            mtPreference: effectiveMtPreference,
          }}
        />
      )}

      {/* Modals & Portals */}
      <LanguageModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
        selectedLangs={selectedLangs}
        onToggleLang={handleToggleLanguage}
      />

      <VoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
        isDark={isDark}
        geminiRefine={{
          enabled: geminiRefineEnabled,
          onChange: setGeminiRefineEnabled,
          serverAvailable: serverRefineAvailable,
          serverStatus: serverRefineStatus,
          mtPreference: effectiveMtPreference,
        }}
      />

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
        isEmbeddedIframe={isEmbeddedIframe}
      />

      <PipSubtitlePortal
        pipWindow={pipWindow}
        onClosePip={closePip}
        isDark={isDark}
        isListening={isListening}
        onToggleListening={toggleListening}
        fontSize={fontSize}
        onAdjustFont={handleAdjustFont}
        selectedLangs={selectedLangs}
        visibleLines={visiblePipLines}
        onToggleLine={handleTogglePipLine}
        layout={pipLayout}
        onToggleLayout={() => setPipLayout((prev) => (prev === 'columns' ? 'stacked' : 'columns'))}
        currentSegment={currentSegment}
        interimTranscript={interimTranscript}
        liveTranslations={liveTranslations}
      />
    </div>
  );
}
