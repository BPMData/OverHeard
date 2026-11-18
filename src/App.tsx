/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createFinalDeduper } from './speechDedupe';
import { SpeechDebugPanel, logSpeechEvent } from './speechDebug';
import { withMicAccess } from './micPermission';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Columns3,
  Download,
  ExternalLink,
  FlaskConical,
  Globe,
  HelpCircle,
  History,
  Mic,
  MicOff,
  Moon,
  PictureInPicture2,
  Send,
  Square,
  Subtitles,
  Sun,
  Trash2,
  Upload,
  Volume2,
  Zap,
} from 'lucide-react';
import { piperClient, type PlaybackHandle } from './tts/piperClient';
import { resolveVoiceId, useVoicePreferences } from './tts/voices';
import {
  DEFAULT_FONT_SIZE,
  FONT_STEP,
  LANGUAGE_MAP,
  MAX_FONT_SIZE,
  MAX_LANGUAGES,
  MIN_FONT_SIZE,
  SAMPLE_SENTENCES,
} from './constants';
import { CaptionSegment, ConversationLanguage, DisplayMode, LanguageCode, PipLayout, PipLine } from './types';
import { translateConversationMessage } from './conversation/translateMessage';
import { loadLectureEntries, saveLectureEntries, type LectureEntry } from './conversation/lectureState';
import { ConversationMode } from './components/ConversationMode';
import { OpenFromDriveButton } from './components/DriveLectureActions';
import { loadConversationSettings, saveConversationSettings } from './components/conversationSettings';
import { JoinRoomForm } from './rooms/StudentRoom';
import { formatLectureFilename } from './rooms/LectureFiles';
import { MAX_ROOM_FILE_BYTES, parseRoomJson, roomJson } from './rooms/protocol';
import { LISTENING_PIP_LAYOUT_STORAGE_KEY, parsePipLayout } from './rooms/studentPrefs';
import { LanguageModal } from './components/LanguageModal';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { WhiteboatIcon } from './components/WhiteboatIcon';
import { useLiveTranslations } from './useLiveTranslations';
import { useServerConfig } from './translation/useServerConfig';
import { isFailedSession, restartDelay } from './speechRestart';
import {
  CaptionSwatch,
  CaptionText,
  ENGLISH_CAPTION_COLOR,
  languageCaptionColor,
} from './captionColors';
import { useTranslator } from './translation/useTranslator';
import {
  isOnDeviceTranslationSupported,
  prepareOnDeviceSpeech,
  prepareOnDeviceTranslators,
} from './onDevice';
import { togglePipLine, visiblePipLines as getVisiblePipLines } from './pipLines';
import { AboutModal } from './components/AboutModal';
import { PackProgressPanel } from './components/PackProgressPanel';
import {
  MAX_PIP_LINES,
  PipSubtitlePortal,
  pipHeightFor,
} from './components/PipSubtitlePortal';

import type { SpeechRecognitionErrorEvent, SpeechRecognitionEvent, SpeechRecognitionInstance } from './speech/types';
import {
  formatTimestamp,
  LIVE_INTERIM_TRANSLATION,
  MT_PROVIDER_LABELS,
  overBy,
  parseInitialLanguages,
  PIP_LINES_STORAGE_KEY,
  PIP_SIZE_STORAGE_KEY,
  SLOW_TRANSLATION_MS,
  type MtPreference,
} from './app/settings';

export default function App() {
  // Theme state (Dark mode default for projector legibility)
  const [isDark, setIsDark] = useState<boolean>(true);

  // Language selection state hydrated from ?langs=
  const [selectedLangs, setSelectedLangs] = useState<LanguageCode[]>(() =>
    parseInitialLanguages()
  );
  const [subtitleLang, setSubtitleLang] = useState<LanguageCode>(
    () => parseInitialLanguages()[0] || 'es'
  );

  // Display & typography controls
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [showPreviousLine, setShowPreviousLine] = useState<boolean>(true);
  const [conversationVisited, setConversationVisited] = useState(false);
  const previousMode = useRef<'columns' | 'subtitle'>('columns');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('columns');
  const [voicePrefs] = useVoicePreferences();
  const [columnPlayback, setColumnPlayback] = useState<{
    code: LanguageCode;
    status: 'downloading' | 'playing';
  } | null>(null);
  const columnPlayHandleRef = useRef<PlaybackHandle | null>(null);
  const columnPlayGenRef = useRef(0);

  const stopColumnPlayback = useCallback(() => {
    columnPlayGenRef.current += 1;
    columnPlayHandleRef.current?.stop();
    columnPlayHandleRef.current = null;
    setColumnPlayback(null);
  }, []);

  const speakColumnTranslation = useCallback(
    (code: LanguageCode, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stopColumnPlayback();
      const gen = columnPlayGenRef.current;
      const voiceId = resolveVoiceId(code, voicePrefs);
      piperClient.unlockAudio();
      let settled = false;
      setColumnPlayback({ code, status: 'playing' });
      const handle = piperClient.speak(trimmed, {
        lang: code,
        voiceId,
        onDownloading: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          setColumnPlayback({ code, status: 'downloading' });
        },
        onStart: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          setColumnPlayback({ code, status: 'playing' });
        },
        onEnd: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          settled = true;
          columnPlayHandleRef.current = null;
          setColumnPlayback(null);
        },
        onError: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          settled = true;
          columnPlayHandleRef.current = null;
          setColumnPlayback(null);
        },
      });
      if (!settled && gen === columnPlayGenRef.current) {
        columnPlayHandleRef.current = handle;
      } else if (gen !== columnPlayGenRef.current) {
        handle.stop();
      }
    },
    [stopColumnPlayback, voicePrefs],
  );

  useEffect(() => {
    if (displayMode !== 'columns') stopColumnPlayback();
  }, [displayMode, stopColumnPlayback]);

  useEffect(() => () => stopColumnPlayback(), [stopColumnPlayback]);

  // Modals & drawers
  const [isLangModalOpen, setIsLangModalOpen] = useState<boolean>(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState<boolean>(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState<boolean>(false);
  const [isTestBarOpen, setIsTestBarOpen] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');
  const [importedLecture, setImportedLecture] = useState<{ seq: number; entries: LectureEntry[] } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importSeqRef = useRef<number>(0);

  // Speech recognition & permission states
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [micPermissionDenied, setMicPermissionDenied] = useState<boolean>(false);
  const [micInsecure, setMicInsecure] = useState(false);
  const [speechStatusNotice, setSpeechStatusNotice] = useState<string | null>(null);

  // Transcript store
  const [segments, setSegments] = useState<CaptionSegment[]>([]);

  // Silent testing input
  const [manualInput, setManualInput] = useState<string>('');

  // Document Picture-in-Picture window state
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipNotice, setPipNotice] = useState<string | null>(null);

  // Which lines the pop-out shows (English and/or languages). Default: English + first 2 languages.
  const [pipLines, setPipLines] = useState<PipLine[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PIP_LINES_STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length > 0) return saved as PipLine[];
    } catch {
      // Storage unavailable or malformed; fall back to the default
    }
    return ['en', ...parseInitialLanguages().slice(0, MAX_PIP_LINES - 1)];
  });

  const [pipLayout, setPipLayout] = useState<PipLayout>(() => {
    try {
      return parsePipLayout(localStorage.getItem(LISTENING_PIP_LAYOUT_STORAGE_KEY));
    } catch {
      return 'stacked';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PIP_LINES_STORAGE_KEY, JSON.stringify(pipLines));
    } catch {
      // Ignore storage failures; the choice still applies for this session
    }
  }, [pipLines]);

  useEffect(() => {
    try {
      localStorage.setItem(LISTENING_PIP_LAYOUT_STORAGE_KEY, pipLayout);
    } catch {
      // Ignore storage failures
    }
  }, [pipLayout]);

  // Environment checks
  const [isSupportedBrowser, setIsSupportedBrowser] = useState<boolean>(true);
  const [hasSpeechApi, setHasSpeechApi] = useState<boolean>(true);
  const [hasPipApi, setHasPipApi] = useState<boolean>(false);
  const [isEmbeddedIframe, setIsEmbeddedIframe] = useState<boolean>(false);

  // Refs for synchronous access in event callbacks & concurrency tracking
  const userStoppedRef = useRef<boolean>(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Keep-alive backoff: only failed sessions (network errors, instant ends) slow restarts down
  const restartTimerRef = useRef<number | null>(null);
  const restartFailuresRef = useRef<number>(0);
  const sessionStartedAtRef = useRef<number>(0);
  const lastSpeechErrorRef = useRef<string | null>(null);
  const nextIdRef = useRef<number>(1);
  const selectedLangsRef = useRef<LanguageCode[]>(selectedLangs);
  const finalizedHistoryRef = useRef<string[]>([]);

  const {
    availableProviders, refineEnabledRef, serverRefineAvailable, serverRefineStatus,
    geminiRefineEnabled, geminiRefineEnabledRef, setGeminiRefineEnabled,
  } = useServerConfig(isVoiceSettingsOpen);
  const {
    effectiveMtPreference, setMtPreference, mtPreferenceRef, onDeviceSupported,
    lastUsedProvider, lastTranslateMs, fetchMT, fetchTranslationWithRetry, getMtProvider,
  } = useTranslator(availableProviders);

  // Whether speech recognition is running on this device (null = not started yet)
  const [speechIsLocal, setSpeechIsLocal] = useState<boolean | null>(null);
  // On-device language pack downloads in progress: language code → 0–1, or 'speech' → -1
  // (Chrome reports no progress for speech packs, so that one shows elapsed time only)
  const [packProgress, setPackProgress] = useState<Record<string, number>>({});
  const [packStartedAt, setPackStartedAt] = useState<number | null>(null);
  const [, setPackTick] = useState(0);
  const packDownloading = Object.keys(packProgress).length > 0;

  const reportPack = useCallback((key: string, fraction: number | null) => {
    setPackProgress((prev) => {
      const next = { ...prev };
      if (fraction === null || fraction >= 1) delete next[key];
      else next[key] = fraction;
      return next;
    });
  }, []);

  useEffect(() => {
    if (packDownloading && packStartedAt === null) setPackStartedAt(Date.now());
    if (!packDownloading && packStartedAt !== null) setPackStartedAt(null);
  }, [packDownloading, packStartedAt]);

  // Re-render once a second while downloading so the elapsed time ticks
  useEffect(() => {
    if (!packDownloading) return;
    const id = window.setInterval(() => setPackTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [packDownloading]);

  // Live (interim) translation state
  // Bumped whenever a phrase is finalized or the transcript is cleared: starts a new live utterance
  const [liveSegment, setLiveSegment] = useState(0);

  useEffect(() => {
    selectedLangsRef.current = selectedLangs;
    if (!selectedLangs.includes(subtitleLang) && selectedLangs.length > 0) {
      setSubtitleLang(selectedLangs[0]);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('langs', selectedLangs.join(','));
    window.history.replaceState({}, '', url.toString());
  }, [selectedLangs, subtitleLang]);

  // Sync dark mode class on <html>, <body>, and PiP window
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      document.body.className =
        'bg-[#090D16] text-[#F8FAFC] antialiased selection:bg-[#5843A5]/35';
    } else {
      root.classList.remove('dark');
      document.body.className =
        'bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-[#5843A5]/20';
    }

    if (pipWindow && !pipWindow.closed) {
      if (isDark) {
        pipWindow.document.documentElement.classList.add('dark');
      } else {
        pipWindow.document.documentElement.classList.remove('dark');
      }
    }
  }, [isDark, pipWindow]);

  // Initial browser capability detection
  useEffect(() => {
    const ua = navigator.userAgent;
    const isChromeOrEdge =
      (/Chrome\//.test(ua) || /Edg\//.test(ua) || /CriOS\//.test(ua)) &&
      !/OPR\//.test(ua);
    const speechAvailable = Boolean(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );

    setIsSupportedBrowser(isChromeOrEdge && speechAvailable);
    setHasSpeechApi(speechAvailable);
    setHasPipApi(Boolean(window.documentPictureInPicture));

    try {
      setIsEmbeddedIframe(window.self !== window.top);
    } catch {
      setIsEmbeddedIframe(true);
    }
  }, []);

  // Interim speech: translate the in-progress sentence so captions appear while the teacher is
  // still talking, even through a long run-on sentence with no pause
  const clearLiveTranslation = useCallback(() => setLiveSegment((value) => value + 1), []);
  const liveTranslations: Partial<Record<string, string>> = useLiveTranslations(
    LIVE_INTERIM_TRANSLATION ? interimTranscript : '',
    selectedLangs,
    fetchMT,
    String(liveSegment),
  );

  // Finalized phrase: fast MT per language in parallel (each column paints as soon as it lands),
  // then an optional Gemini pass quietly upgrades the text with context.
  const handleFinalizedPhrase = useCallback(
    (rawPhrase: string) => {
      const phrase = rawPhrase.trim().slice(0, 500);
      if (!phrase) return;

      const contextSnapshot = finalizedHistoryRef.current.slice(-2);
      finalizedHistoryRef.current = [
        ...finalizedHistoryRef.current.slice(-20),
        phrase,
      ];

      const segmentId = nextIdRef.current++;
      const langs = [...selectedLangsRef.current];

      setSegments((prev) => [
        ...prev,
        {
          id: segmentId,
          timestamp: formatTimestamp(),
          english: phrase,
          translations: {},
          status: 'translating',
        },
      ]);

      const patch = (fn: (seg: CaptionSegment) => CaptionSegment) =>
        setSegments((prev) =>
          prev.map((seg) => (seg.id === segmentId ? fn(seg) : seg))
        );

      let failures = 0;
      const mtJobs = langs.map((code) =>
        fetchMT(phrase, code).then(
          (translation) =>
            patch((seg) => ({
              ...seg,
              translations: { ...seg.translations, [code]: translation },
            })),
          () => {
            failures += 1;
            patch((seg) => ({
              ...seg,
              translations: {
                ...seg.translations,
                [code]: 'translation unavailable',
              },
            }));
          }
        )
      );

      void Promise.all(mtJobs).then(async () => {
        patch((seg) => ({
          ...seg,
          status: failures === langs.length ? 'error' : 'done',
        }));

        // Optional Gemini clean-up, only for languages that weren't translated on this device
        // (so on-device text never leaves the machine, and the server's Gemini calls stay low).
        // "On this device" mode skips it entirely.
        const preference = mtPreferenceRef.current;
        const refineLangs =
          !refineEnabledRef.current ||
          !geminiRefineEnabledRef.current ||
          preference === 'on-device'
            ? []
            : langs.filter(
                (code) =>
                  getMtProvider(preference, 'en', code, phrase) !==
                  'on-device'
              );
        if (refineLangs.length === 0) return;
        const refined = await fetchTranslationWithRetry(
          phrase,
          refineLangs,
          contextSnapshot
        ).catch(() => null);
        if (!refined) return;
        patch((seg) => {
          const merged = { ...seg.translations };
          for (const code of refineLangs) {
            const value = refined[code];
            if (value && value !== 'translation unavailable') merged[code] = value;
          }
          return { ...seg, translations: merged, status: 'done' };
        });
      });
    },
    [fetchMT, fetchTranslationWithRetry, getMtProvider, mtPreferenceRef, refineEnabledRef, geminiRefineEnabledRef]
  );

  // Start / Stop Web Speech API with Chrome Keep-Alive Loop
  const startListening = useCallback(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setHasSpeechApi(false);
      return;
    }

    setMicPermissionDenied(false);
    setSpeechStatusNotice(null);
    userStoppedRef.current = false;
    restartFailuresRef.current = 0;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      let newWords = createFinalDeduper();

      recognition.onstart = () => {
        newWords = createFinalDeduper();
        sessionStartedAtRef.current = Date.now();
        lastSpeechErrorRef.current = null;
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        logSpeechEvent(event);
        // Hearing speech means the service is healthy again
        restartFailuresRef.current = 0;
        setSpeechStatusNotice(null);
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcriptText = result[0]?.transcript || '';
          if (result.isFinal) {
            setInterimTranscript('');
            clearLiveTranslation();
            const fresh = newWords(transcriptText);
            if (fresh) handleFinalizedPhrase(fresh);
          } else {
            interim += transcriptText;
          }
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const errCode = event.error;
        lastSpeechErrorRef.current = errCode;
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          userStoppedRef.current = true;
          setIsListening(false);
          setInterimTranscript('');
          setMicPermissionDenied(true);
          return;
        }

        // On 'no-speech', 'network', or 'aborted' errors, keep restarting via onend keep-alive
        if (
          errCode === 'no-speech' ||
          errCode === 'network' ||
          errCode === 'aborted'
        ) {
          if (errCode === 'network') {
            setSpeechStatusNotice('Reconnecting speech service…');
          }
          return;
        }
      };

      recognition.onend = () => {
        // Keep-alive: Chrome stops recognition after silence. If user has not pressed Stop, call start() again.
        // Normal ends restart immediately; repeated failures (e.g. offline) back off up to 5 s.
        if (!userStoppedRef.current) {
          const sessionMs = Date.now() - sessionStartedAtRef.current;
          if (isFailedSession(lastSpeechErrorRef.current, sessionMs)) {
            restartFailuresRef.current += 1;
          } else {
            restartFailuresRef.current = 0;
          }
          const restart = () => {
            restartTimerRef.current = null;
            if (userStoppedRef.current) return;
            try {
              recognition.start();
            } catch {
              // Ignore InvalidStateError when already running
            }
          };
          const delay = restartDelay(restartFailuresRef.current);
          if (delay === 0) {
            restart();
          } else {
            if (restartFailuresRef.current >= 3) {
              setSpeechStatusNotice('Speech service unavailable — retrying…');
            }
            restartTimerRef.current = window.setTimeout(restart, delay);
          }
        } else {
          setIsListening(false);
          setInterimTranscript('');
        }
      };

      recognitionRef.current = recognition;
    }

    const recognition = recognitionRef.current;
    const begin = (local: boolean) => {
      if (userStoppedRef.current) return; // Stop was pressed while the speech pack downloaded
      recognition.processLocally = local;
      setSpeechIsLocal(local);
      try {
        recognition.start();
      } catch {
        // Ignore InvalidStateError if already running
      }
      setIsListening(true);
    };

    if (mtPreferenceRef.current === 'on-device') {
      // Both downloads need a click, and this runs inside the Start click
      prepareOnDeviceTranslators(selectedLangsRef.current, reportPack);
      setIsListening(true);
      void prepareOnDeviceSpeech('en-US', () => reportPack('speech', -1)).then((local) => {
        reportPack('speech', null);
        setSpeechStatusNotice(
          local ? null : 'On-device speech not available here — using Google’s speech service.'
        );
        begin(local);
      });
    } else {
      // Auto: fetch the translation packs now (this click is the gesture Chrome requires) so
      // on-device translation takes over as soon as they're ready. Captions keep flowing
      // through the online translators in the meantime. Speech stays on Google's service.
      if (mtPreferenceRef.current === 'auto' && isOnDeviceTranslationSupported()) {
        prepareOnDeviceTranslators(selectedLangsRef.current, reportPack);
      }
      begin(false);
    }
  }, [handleFinalizedPhrase, clearLiveTranslation, reportPack, mtPreferenceRef]);

  const stopListening = useCallback(() => {
    userStoppedRef.current = true;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
    clearLiveTranslation();
    setSpeechStatusNotice(null);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }, [clearLiveTranslation]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      withMicAccess(startListening, (reason) => {
        setMicInsecure(reason === 'insecure');
        setMicPermissionDenied(true);
      });
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      userStoppedRef.current = true;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  // Spacebar toggles Start/Stop unless focus is inside <input>, <textarea>, or <select>
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (displayMode === 'conversation' || e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      toggleListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayMode, toggleListening]);

  // Toggle a target language (minimum 1, maximum 3)
  const handleToggleLanguage = (code: LanguageCode) => {
    setSelectedLangs((prev) => {
      if (prev.includes(code)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== code);
      }
      if (prev.length >= MAX_LANGUAGES) return prev;
      return [...prev, code];
    });
  };

  // Font size adjustment (20px to 56px)
  const handleAdjustFont = (delta: number) => {
    setFontSize((prev) =>
      Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, prev + delta))
    );
  };

  // Document Picture-in-Picture Pop-Out Window
  const handleTogglePip = async () => {
    setPipNotice(null);

    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      setPipWindow(null);
      return;
    }

    if (!window.documentPictureInPicture) {
      setPipNotice(
        'Floating Picture-in-Picture requires desktop Chrome or Edge. Use Subtitle Mode or tile windows side-by-side.'
      );
      return;
    }

    try {
      // Reopen at the size the user last dragged it to (e.g. a tall strip down the side);
      // otherwise start as a compact subtitle strip.
      let savedSize: { width?: number; height?: number } | null = null;
      try {
        savedSize = JSON.parse(localStorage.getItem(PIP_SIZE_STORAGE_KEY) || 'null');
      } catch {
        savedSize = null;
      }
      const win = await window.documentPictureInPicture.requestWindow({
        width:
          savedSize?.width && savedSize.width >= 120 ? savedSize.width : 920,
        height:
          savedSize?.height && savedSize.height >= 60
            ? savedSize.height
            : pipHeightFor(visiblePipLines.length),
      });

      // Remember the shape whenever the user resizes it
      let sizeSaveTimer: number | undefined;
      win.addEventListener('resize', () => {
        window.clearTimeout(sizeSaveTimer);
        sizeSaveTimer = window.setTimeout(() => {
          try {
            localStorage.setItem(
              PIP_SIZE_STORAGE_KEY,
              JSON.stringify({ width: win.innerWidth, height: win.innerHeight })
            );
          } catch {
            // Ignore storage failures
          }
        }, 300);
      });

      // Copy stylesheets & Google Fonts from main document into the PiP window
      Array.from(document.styleSheets).forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            win.document.head.appendChild(link);
          } else if (styleSheet.cssRules) {
            const style = win.document.createElement('style');
            const cssText = Array.from(styleSheet.cssRules)
              .map((rule) => rule.cssText)
              .join('\n');
            style.textContent = cssText;
            win.document.head.appendChild(style);
          }
        } catch {
          // Cross-origin stylesheet fallback
          if (styleSheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            win.document.head.appendChild(link);
          }
        }
      });

      win.document.title = 'OverHeard — Live Captions';
      win.document.body.style.margin = '0';
      if (isDark) {
        win.document.documentElement.classList.add('dark');
      }

      win.addEventListener('pagehide', () => {
        setPipWindow(null);
      });

      setPipWindow(win);
    } catch {
      setPipNotice(
        isEmbeddedIframe
          ? 'Pop-out windows are blocked inside embedded preview frames. Click "Open Full Tab" in the top banner to pop out captions over slides.'
          : 'Could not open floating window. Try Subtitle Mode at the bottom of the screen.'
      );
    }
  };

  // Lecture-compatible JSON Transcript Export
  const handleExportJson = () => {
    if (segments.length === 0) return;

    const toEpochMs = (hhmmss: string): number => {
      const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(hhmmss.trim());
      if (!match) return Date.now();
      const d = new Date();
      d.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0);
      return d.getTime();
    };

    const entries: LectureEntry[] = [];
    for (const seg of segments) {
      const english = seg.english.trim();
      if (!english) continue;
      const translations: Partial<Record<LanguageCode, string>> = {};
      const failedLangs: Partial<Record<LanguageCode, boolean>> = {};
      for (const code of selectedLangs) {
        const translated = seg.translations[code]?.trim();
        if (translated) {
          translations[code] = translated;
        } else if (seg.status === 'error') {
          failedLangs[code] = true;
        }
      }
      entries.push({
        id: `seg-${seg.id}`,
        timestamp: toEpochMs(seg.timestamp),
        english,
        translations,
        failedLangs,
      });
    }

    if (entries.length === 0) return;

    const jsonContent = roomJson({ selectedLangs, entries });
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = formatLectureFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Clear transcript history
  const handleClearConfirm = () => {
    stopColumnPlayback();
    setSegments([]);
    setInterimTranscript('');
    finalizedHistoryRef.current = [];
    clearLiveTranslation();
    setConfirmClear(false);
  };

  // Submit silent test sentence
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleFinalizedPhrase(manualInput);
    setManualInput('');
  };

  // Burst test (5 rapid sentences to exercise parallel per-language translation)
  const handleBurstTest = () => {
    const burstSentences = [
      'Good morning class, today we are studying the water cycle.',
      'First, solar energy warms water on the surface of oceans and lakes.',
      'This causes evaporation, turning liquid water into invisible water vapor.',
      'As the warm air rises into the atmosphere, it cools down and condenses into clouds.',
      'Finally, precipitation returns water to the Earth as rain, snow, or sleet.',
    ];
    burstSentences.forEach((sentence) => {
      handleFinalizedPhrase(sentence);
    });
  };

  // Pop-out lines: keep only English + languages still selected, in on-screen order
  const visiblePipLines = getVisiblePipLines(pipLines, selectedLangs, MAX_PIP_LINES);

  const handleTogglePipLine = (line: PipLine) => {
    const next = togglePipLine(visiblePipLines, line, selectedLangs, MAX_PIP_LINES);
    if (!next) return;
    // Never resize the window here: the user may have shaped it (wide strip, tall column…)
    // and the caption lines already re-share whatever space it has.
    setPipLines(next);
  };

  const currentSegment =
    segments.length > 0 ? segments[segments.length - 1] : null;
  const previousSegment =
    segments.length > 1 ? segments[segments.length - 2] : null;
  const previousFontSize = Math.max(16, Math.round(fontSize * 0.68));
  const activeSubtitleLang = selectedLangs.includes(subtitleLang)
    ? subtitleLang
    : selectedLangs[0];
  const subtitleCaptionColor = languageCaptionColor(
    Math.max(0, selectedLangs.indexOf(activeSubtitleLang))
  );

  const gridColsClass =
    selectedLangs.length === 1
      ? 'grid-cols-1 lg:grid-cols-2'
      : selectedLangs.length === 2
      ? 'grid-cols-1 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';

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
      pipWindow?.close();
      setPipWindow(null);
      setPipNotice(null);
      setMicPermissionDenied(false);
      setImportedLecture({ seq: ++importSeqRef.current, entries: imported.entries });
      setConversationVisited(true);
      setDisplayMode('conversation');
    },
    [displayMode, pipWindow, selectedLangs, stopListening],
  );

  const permissionBanner = micPermissionDenied && (
    <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-3 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start sm:items-center gap-2.5 text-red-800 dark:text-red-200">
        <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5 sm:mt-0" />
        <div>
          {micInsecure ? (
            <>
              <strong>Microphone unavailable on this address:</strong> browsers only allow the
              microphone on <strong>https://</strong> pages (or localhost). Open OverHeard from its
              https link instead of {window.location.origin}.
            </>
          ) : (
            <>
              <strong>Microphone Permission Blocked:</strong> the browser didn&apos;t allow the
              microphone. On a computer, click the tune/lock icon in the address bar and set{' '}
              <strong>Microphone</strong> to <strong>Allow</strong>. On Android, tap the tune/lock
              icon → <strong>Permissions</strong> → <strong>Microphone</strong> → Allow (in the
              installed app: long-press its icon → App info → Permissions). If Chrome itself lacks
              mic access, enable it in Android Settings → Apps → Chrome → Permissions. Then press{' '}
              <strong>{displayMode === 'conversation' ? 'Start conversation' : 'Start Listening'}</strong> again.
            </>
          )}
          {isEmbeddedIframe && (
            <span>
              {' '}
              (Note: Microphones are often blocked inside embedded preview panes — open OverHeard in a full browser tab.)
            </span>
          )}
        </div>
      </div>
      {isEmbeddedIframe && (
        <a
          href={window.location.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold text-xs hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
        >
          <span>Open Full Tab</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );

  const translatorPicker = (
    <label
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap"
      title={
        lastUsedProvider
          ? `Last caption translated by: ${MT_PROVIDER_LABELS[lastUsedProvider]}`
          : 'Which translator powers live captions. Auto uses this device when it can, then the online translators in order.'
      }
    >
      <span className="text-[#64748B] dark:text-[#94A3B8]">Translator</span>
      <select
        value={effectiveMtPreference}
        onChange={(e) => {
          const next = e.target.value as MtPreference;
          setMtPreference(next);
          // Choosing it is a user gesture, so start downloading language packs now
          if (
            (next === 'on-device' || (next === 'auto' && onDeviceSupported)) &&
            displayMode !== 'conversation'
          ) {
            prepareOnDeviceTranslators(selectedLangs, reportPack);
          }
        }}
        className="bg-transparent font-semibold outline-none cursor-pointer text-[#0F172A] dark:text-[#F8FAFC] [&>option]:text-[#0F172A]"
      >
        <option value="auto">
          Auto
          {onDeviceSupported
            ? ' (On this device first)'
            : availableProviders[0]
              ? ` (${MT_PROVIDER_LABELS[availableProviders[0]]})`
              : ''}
        </option>
        <option value="on-device" disabled={!onDeviceSupported}>
          {MT_PROVIDER_LABELS['on-device']}
          {onDeviceSupported ? ' (speech too)' : ' (needs desktop Chrome 138+)'}
        </option>
        {availableProviders.map((p) => (
          <option key={p} value={p}>
            {MT_PROVIDER_LABELS[p]}
          </option>
        ))}
      </select>
      {lastTranslateMs !== null && (
        <span
          className={`font-mono ${
            lastTranslateMs > SLOW_TRANSLATION_MS
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-[#64748B] dark:text-[#94A3B8]'
          }`}
          title="Time for the most recent translation, measured in this browser. Every translation is also logged in the browser console."
        >
          {lastTranslateMs} ms{overBy(lastTranslateMs)}
        </span>
      )}
      {displayMode !== 'conversation' && effectiveMtPreference === 'on-device' && speechIsLocal !== null && (
        <span
          className={`font-mono ${
            speechIsLocal
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
          title={
            speechIsLocal
              ? 'Speech recognition is running on this device'
              : 'On-device speech is not available here; using Google’s speech service'
          }
        >
          🎙 {speechIsLocal ? 'local' : 'cloud'}
        </span>
      )}
      {lastUsedProvider &&
        effectiveMtPreference !== 'auto' &&
        lastUsedProvider !== effectiveMtPreference && (
          <span className="text-amber-600 dark:text-amber-400 font-mono">
            ↪ {MT_PROVIDER_LABELS[lastUsedProvider]}
          </span>
        )}
    </label>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#090D16] text-[#0F172A] dark:text-[#F8FAFC] transition-colors">
      <SpeechDebugPanel />
      {/* Browser Compatibility Banner */}
      {displayMode !== 'conversation' && (!isSupportedBrowser || !hasSpeechApi) && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 text-xs sm:text-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Browser Compatibility Notice:</strong> OverHeard is designed for{' '}
              <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> using the Web Speech API.
              {!hasSpeechApi &&
                ' SpeechRecognition is not available in this browser — use the Silent Test Bar below or open in Chrome/Edge.'}
            </span>
          </div>
        </div>
      )}

      {displayMode !== 'conversation' && permissionBanner}

      {/* Pip Notice Banner */}
      {pipNotice && (
        <div className="bg-[#5843A5]/15 border-b border-[#5843A5]/30 px-4 py-2 text-xs flex items-center justify-between gap-4 text-[#3F2E80] dark:text-[#DDD6FE]">
          <span>{pipNotice}</span>
          <div className="flex items-center gap-2 shrink-0">
            {isEmbeddedIframe && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#5843A5] dark:bg-[#6D56C6] text-white font-semibold"
              >
                <span>Open Full Tab</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => setPipNotice(null)}
              className="underline hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {importError && displayMode !== 'conversation' && (
        <div role="alert" className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs flex items-center justify-between gap-4 text-amber-800 dark:text-amber-200">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError('')} className="underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {/* Top Teacher Control Bar */}
      {displayMode !== 'conversation' && <>
      <header className="border-b border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] px-4 lg:px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Brand & Primary Start/Stop Mic Action */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setDisplayMode('columns')}
              aria-label="OverHeard — Go to Columns view"
              title="Back to main Columns view"
              className="flex items-center gap-2.5 shrink-0 cursor-pointer rounded-lg px-1 py-0.5 -mx-1 hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5843A5] dark:focus-visible:ring-[#A78BFA] transition-opacity"
            >
              <WhiteboatIcon app="overheard" size={28} className="shadow-2xs" />
              <span className="text-xl font-extrabold tracking-tight text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap">
                OverHeard
              </span>
            </button>

            {/* Primary Start/Stop Button + Pulsing Mic Indicator */}
            <button
              type="button"
              onClick={toggleListening}
              className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-xs ${
                isListening
                  ? 'bg-[#059669] dark:bg-[#10B981] text-white dark:text-slate-950 ring-4 ring-emerald-500/25'
                  : 'bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white'
              }`}
              title="Toggle microphone (Shortcut: Spacebar)"
            >
              {isListening ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white dark:bg-slate-950 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-white dark:bg-slate-950" />
                  </span>
                  <Mic className="w-4 h-4" />
                  <span>Stop Listening</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>Start Listening</span>
                </>
              )}
              <span className="hidden sm:inline-block text-xs opacity-75 font-mono">
                [Space]
              </span>
            </button>

            {speechStatusNotice && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {speechStatusNotice}
              </span>
            )}

            <PackProgressPanel progress={packProgress} startedAt={packStartedAt} />
          </div>

          {/* Right: Projector Display & Classroom Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Font Size A- / A+ */}
            <div
              className="inline-flex items-center rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] p-0.5"
              role="group"
              aria-label="Caption font size"
            >
              <button
                type="button"
                onClick={() => handleAdjustFont(-FONT_STEP)}
                disabled={fontSize <= MIN_FONT_SIZE}
                className="px-2.5 py-1.5 text-xs font-bold rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                title="Decrease font size (A-)"
              >
                A-
              </button>
              <span className="px-2 text-xs font-mono text-[#64748B] dark:text-[#94A3B8] whitespace-nowrap">
                {fontSize}px
              </span>
              <button
                type="button"
                onClick={() => handleAdjustFont(FONT_STEP)}
                disabled={fontSize >= MAX_FONT_SIZE}
                className="px-2.5 py-1.5 text-xs font-bold rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                title="Increase font size (A+)"
              >
                A+
              </button>
            </div>

            {/* Show Previous Line Toggle */}
            <button
              type="button"
              onClick={() => setShowPreviousLine((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                showPreviousLine
                  ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#5843A5]/10 dark:bg-[#5843A5]/25 text-[#5843A5] dark:text-[#DDD6FE]'
                  : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
              }`}
              title="Show or hide the preceding caption line"
            >
              <History className="w-3.5 h-3.5" />
              <span>Prev Line</span>
            </button>

            {/* Columns vs Subtitle Mode */}
            <div className="inline-flex items-stretch rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] p-0.5">
              <button
                type="button"
                onClick={() => setDisplayMode('columns')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  displayMode === 'columns'
                    ? 'bg-[#5843A5] dark:bg-[#6D56C6] text-white shadow-2xs'
                    : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                <Columns3 className="w-3.5 h-3.5" />
                <span>Columns</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('subtitle')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  displayMode === 'subtitle'
                    ? 'bg-[#5843A5] dark:bg-[#6D56C6] text-white shadow-2xs'
                    : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                <Subtitles className="w-3.5 h-3.5" />
                <span>Subtitle</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center px-2.5 py-0.5 rounded-md text-xs font-semibold leading-[1.1] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white transition-colors text-center"
                onClick={() => {
                  previousMode.current = displayMode;
                  stopListening();
                  pipWindow?.close();
                  setPipWindow(null);
                  setPipNotice(null);
                  setMicPermissionDenied(false);
                  setConversationVisited(true);
                  setDisplayMode('conversation');
                }}
              >
                <span>Conversation/</span>
                <span className="text-[11px] font-semibold">Lecture</span>
              </button>
            </div>

            <JoinRoomForm />
            <button
              type="button"
              onClick={() => importFileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              title="Open an exported OverHeard lecture JSON file"
            >
              <Upload className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
              <span>Import JSON</span>
            </button>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import lecture JSON on home screen"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                try {
                  if (file.size > MAX_ROOM_FILE_BYTES) {
                    throw new Error('Room file is too large (8 MB maximum).');
                  }
                  const raw =
                    typeof file.text === 'function' ? await file.text() : await new Response(file).text();
                  const imported = parseRoomJson(raw);
                  if (
                    loadLectureEntries().length > 0 &&
                    !window.confirm(
                      'Replace the saved lecture with the imported file? Export JSON first to keep the current transcript.',
                    )
                  ) {
                    return;
                  }
                  applyImportedLecture(imported);
                } catch (err) {
                  setImportError(err instanceof Error ? err.message : 'Could not read room file.');
                }
              }}
            />
            <OpenFromDriveButton
              hasExistingEntries={() => loadLectureEntries().length > 0}
              onImport={(imported) => applyImportedLecture(imported)}
              onError={(msg) => setImportError(msg)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              iconClassName="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]"
            />
            {/* Pop Out Captions (Document Picture-in-Picture) */}
            {hasPipApi && (
              <button
                type="button"
                onClick={handleTogglePip}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  pipWindow
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Open floating always-on-top caption window over slides"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                <span>{pipWindow ? 'Close Pop-out' : 'Pop out captions'}</span>
              </button>
            )}

            {/* Languages Selector Button */}
            <button
              type="button"
              onClick={() => setIsLangModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
              <span>Languages</span>
              <span className="font-mono text-[#64748B] dark:text-[#94A3B8]">
                ({selectedLangs.join(', ')})
              </span>
            </button>

            {/* Settings Button */}
            <button
              type="button"
              onClick={() => setIsVoiceSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              title="Open voice and translation refinement settings"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
              <span>Settings</span>
            </button>

            {/* Translator Picker (live caption provider) */}
            {translatorPicker}

            {/* Silent Test Input Bar Toggle */}
            <button
              type="button"
              onClick={() => setIsTestBarOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                isTestBarOpen
                  ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#5843A5]/10 dark:bg-[#5843A5]/25 text-[#5843A5] dark:text-[#DDD6FE]'
                  : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
              }`}
              title="Toggle silent text input & sample classroom phrases"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>Test Input</span>
            </button>

            {/* Light / Dark Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              className="p-2 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Export Transcript JSON */}
            <button
              type="button"
              onClick={handleExportJson}
              disabled={segments.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title="Export transcript as OverHeard JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>

            {/* Clear Transcript with inline confirmation */}
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={segments.length === 0 && !interimTranscript}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title="Clear captions and transcript"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1">
                <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                  Clear all?
                </span>
                <button
                  type="button"
                  onClick={handleClearConfirm}
                  className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-bold hover:bg-red-500"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-0.5 rounded text-xs text-slate-600 dark:text-slate-300 hover:underline"
                >
                  No
                </button>
              </div>
            )}

            {/* How to Use OverHeard / Guide & FAQ Modal Button */}
            <button
              type="button"
              onClick={() => setIsAboutModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              aria-label="How to use OverHeard: Guide, FAQ, and Privacy"
              title="How to use OverHeard: Guide, FAQ, and Privacy Notice"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
              <span>Guide &amp; FAQ</span>
            </button>
          </div>
        </div>

        {/* Collapsible Silent Test Input Bar */}
        {isTestBarOpen && (
          <div className="mt-3 pt-3 border-t border-[#E2E8F0] dark:border-[#1E293B] flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <form
              onSubmit={handleManualSubmit}
              className="flex-1 flex items-center gap-2"
            >
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                maxLength={500}
                placeholder="Type an English classroom sentence to test translation silently…"
                className="flex-1 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] px-3.5 py-2 text-sm text-[#0F172A] dark:text-[#F8FAFC] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:border-[#5843A5] dark:focus:border-[#A78BFA]"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white text-xs font-bold disabled:opacity-40 transition-all whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Translate</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#64748B] dark:text-[#94A3B8] mr-1">
                Samples:
              </span>
              {SAMPLE_SENTENCES.map((sample) => (
                <button
                  key={sample.subject}
                  type="button"
                  onClick={() => handleFinalizedPhrase(sample.text)}
                  className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] hover:border-[#5843A5] dark:hover:border-[#A78BFA] transition-colors whitespace-nowrap"
                >
                  {sample.subject}
                </button>
              ))}
              <button
                type="button"
                onClick={handleBurstTest}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                title="Send 5 rapid sentences to test concurrent in-order rendering and the >4 in-flight backlog guard"
              >
                <Zap className="w-3 h-3" />
                <span>Fast Burst (5x)</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Projector Display Stage */}
      {displayMode === 'columns' ? (
        <main className="flex-1 p-4 lg:p-6 flex flex-col">
          <div className={`flex-1 grid ${gridColsClass} gap-4 lg:gap-6 items-stretch`}>
            {/* Column 0: English Source Column */}
            <section
              aria-label="English Captions"
              className="flex flex-col rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-bold tracking-tight text-[#0F172A] dark:text-[#F8FAFC]">
                    English
                  </span>
                  <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                    en-US · Teacher
                  </span>
                </div>
                {currentSegment && (
                  <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                    #{currentSegment.id} · {currentSegment.timestamp}
                  </span>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-between p-6 lg:p-8 gap-6">
                {/* Previous Line (0.68x font size, muted, above hairline divider) */}
                {showPreviousLine && (
                  <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] pb-5 min-h-[4.5rem] flex flex-col justify-end">
                    <div className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8] mb-1.5">
                      Previous line
                    </div>
                    {previousSegment ? (
                      <p
                        style={{ fontSize: `${previousFontSize}px` }}
                        className="font-medium text-[#64748B] dark:text-[#94A3B8] caption-text-ltr transition-all"
                      >
                        {previousSegment.english}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400 dark:text-slate-600 italic">
                        No preceding sentence yet
                      </p>
                    )}
                  </div>
                )}

                {/* Current Line + Dimmed Live Interim Speech */}
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  {currentSegment ? (
                    <p
                      style={{ fontSize: `${fontSize}px` }}
                      className="font-bold caption-text-ltr tracking-tight"
                    >
                      <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                        {currentSegment.english}
                      </CaptionText>
                    </p>
                  ) : (
                    !interimTranscript && (
                      <div className="space-y-2">
                        <p
                          style={{ fontSize: `${Math.max(22, Math.round(fontSize * 0.78))}px` }}
                          className="font-semibold text-[#64748B] dark:text-[#94A3B8]"
                        >
                          {isListening
                            ? 'Listening… speak naturally in English.'
                            : 'Press Start Listening (or Spacebar) to begin live classroom captions.'}
                        </p>
                        <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8]">
                          Want to test silently first? Click <strong>Test Input</strong> in the top bar to try sample Science, Math, or History sentences.
                        </p>
                      </div>
                    )
                  )}

                  {/* Live Interim Speech (dimmed) */}
                  {interimTranscript.trim().length > 0 && (
                    <div className="pt-2">
                      <span className="inline-block text-xs font-mono text-[#5843A5] dark:text-[#C4B5FD] mb-1">
                        Speaking live…
                      </span>
                      <p
                        style={{ fontSize: `${fontSize}px` }}
                        className="font-semibold italic opacity-70 caption-text-ltr"
                      >
                        <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                          {interimTranscript}
                        </CaptionText>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Target Language Columns (up to 3) */}
            {selectedLangs.map((code, langIndex) => {
              const lang = LANGUAGE_MAP[code];
              const isRtl = lang.dir === 'rtl';
              const captionColor = languageCaptionColor(langIndex);
              const prevText = previousSegment?.translations[code];
              const currText = currentSegment?.translations[code];
              const isTranslating =
                currentSegment?.status === 'translating' && !currText;
              const isUnavailable = currText === 'translation unavailable';
              const canPlay = Boolean(currText && !isTranslating && !isUnavailable);
              const isThisColActive = columnPlayback?.code === code;

              return (
                <section
                  key={code}
                  aria-label={`${lang.name} Translation`}
                  className="flex flex-col rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
                    <div className="flex items-center gap-2.5">
                      <CaptionSwatch color={captionColor} />
                      <span className="text-base font-bold tracking-tight text-[#0F172A] dark:text-[#F8FAFC]">
                        {lang.name}
                      </span>
                      <span
                        dir={lang.dir}
                        className="text-xs text-[#64748B] dark:text-[#94A3B8]"
                      >
                        {lang.nativeName}
                        {isRtl ? ' · RTL' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!canPlay && !isThisColActive}
                        onClick={() => {
                          if (isThisColActive) stopColumnPlayback();
                          else if (currText) speakColumnTranslation(code, currText);
                        }}
                        aria-label={
                          isThisColActive
                            ? `Stop reading ${lang.name} translation`
                            : `Read ${lang.name} translation aloud`
                        }
                        title={
                          isThisColActive
                            ? 'Stop reading'
                            : canPlay
                              ? `Read ${lang.name} translation aloud`
                              : 'Translation appears here after a sentence finishes'
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border transition-colors ${
                          isThisColActive
                            ? 'border-[#5843A5] bg-[#5843A5] text-white dark:border-[#A78BFA] dark:bg-[#5843A5]'
                            : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#475569] dark:text-[#CBD5E1] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
                        }`}
                      >
                        {isThisColActive ? (
                          <>
                            <Square className="w-3 h-3" />
                            <span>
                              {columnPlayback.status === 'downloading' ? 'Loading…' : 'Stop'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
                            <span>Play</span>
                          </>
                        )}
                      </button>
                      <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                        {code}
                      </span>
                    </div>
                  </div>

                  <div
                    dir={lang.dir}
                    className="flex-1 flex flex-col justify-between p-6 lg:p-8 gap-6"
                  >
                    {/* Previous Translated Line */}
                    {showPreviousLine && (
                      <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] pb-5 min-h-[4.5rem] flex flex-col justify-end">
                        <div
                          dir="ltr"
                          className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8] mb-1.5"
                        >
                          Previous line
                        </div>
                        {previousSegment ? (
                          <p
                            style={{ fontSize: `${previousFontSize}px` }}
                            className={`font-medium text-[#64748B] dark:text-[#94A3B8] ${
                              isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                            }`}
                          >
                            {prevText ||
                              (previousSegment.status === 'translating'
                                ? '…'
                                : 'translation unavailable')}
                          </p>
                        ) : (
                          <p
                            dir="ltr"
                            className="text-sm text-slate-400 dark:text-slate-600 italic"
                          >
                            No preceding sentence yet
                          </p>
                        )}
                      </div>
                    )}

                    {/* Current Translated Line */}
                    <div className="flex-1 flex flex-col justify-center">
                      {currentSegment ? (
                        isTranslating ? (
                          <p
                            style={{ fontSize: `${Math.round(fontSize * 0.8)}px` }}
                            className="font-medium text-[#64748B] dark:text-[#94A3B8] animate-pulse"
                          >
                            Translating…
                          </p>
                        ) : isUnavailable ? (
                          <p
                            dir="ltr"
                            className="text-lg font-medium text-amber-600 dark:text-amber-400 italic"
                          >
                            translation unavailable
                          </p>
                        ) : (
                          <p
                            style={{ fontSize: `${fontSize}px` }}
                            className={`font-bold tracking-tight ${
                              isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                            }`}
                          >
                            <CaptionText color={captionColor} isDark={isDark}>
                              {currText}
                            </CaptionText>
                          </p>
                        )
                      ) : (
                        <p
                          dir="ltr"
                          className="text-base text-slate-400 dark:text-slate-600"
                        >
                          {lang.name} translation will appear here as each sentence completes.
                        </p>
                      )}

                      {/* Live translation of in-progress speech (dimmed, mirrors English interim) */}
                      {interimTranscript.trim().length > 0 && liveTranslations[code] && (
                        <p
                          style={{ fontSize: `${fontSize}px` }}
                          className={`pt-4 font-semibold italic opacity-70 ${
                            isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                          }`}
                        >
                          <CaptionText color={captionColor} isDark={isDark}>
                            {liveTranslations[code]}
                          </CaptionText>
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </main>
      ) : (
        /* Subtitle Bar Mode: Upper Workspace Stage + Fixed Bottom Subtitle Overlay Bar */
        <main className="flex-1 flex flex-col justify-between p-4 lg:p-8 pb-56">
          <div className="max-w-4xl mx-auto w-full rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white/60 dark:bg-[#111827]/60 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#0F172A] dark:text-[#F8FAFC]">
                  Subtitle Bar Mode Active
                </h2>
                <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8]">
                  The compact two-line caption bar is pinned to the bottom of the screen so you can position slides above it or pop it out into a floating window.
                </p>
              </div>
              {hasPipApi ? (
                <button
                  type="button"
                  onClick={handleTogglePip}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white text-xs font-bold whitespace-nowrap transition-colors"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                  <span>
                    {pipWindow ? 'Close Floating Window' : 'Pop out captions over slides'}
                  </span>
                </button>
              ) : (
                <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Tip: Resize or tile this window beneath your presentation slides.
                </span>
              )}
            </div>

            {segments.length > 0 && (
              <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#1E293B] max-h-60 overflow-y-auto space-y-2">
                <div className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                  Recent Transcript ({segments.length} phrases)
                </div>
                {segments.slice(-5).map((seg) => (
                  <div
                    key={seg.id}
                    className="text-xs flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-1 border-b border-slate-200/50 dark:border-slate-800/60 last:border-0"
                  >
                    <span className="font-mono text-[#64748B] dark:text-[#94A3B8] shrink-0">
                      [{seg.timestamp}]
                    </span>
                    <span className="font-medium text-[#0F172A] dark:text-[#F8FAFC]">
                      {seg.english}
                    </span>
                    <span
                      dir={LANGUAGE_MAP[activeSubtitleLang].dir}
                      className="text-[#5843A5] dark:text-[#C4B5FD]"
                    >
                      → {seg.translations[activeSubtitleLang] || '…'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fixed Bottom Subtitle Bar */}
          <section
            aria-label="Bottom Subtitle Bar"
            className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-[#5843A5]/50 dark:border-[#A78BFA]/45 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md px-6 py-4 shadow-2xl"
          >
            <div className="max-w-7xl mx-auto flex flex-col gap-2.5">
              {/* Top Row: English Caption + Language Switcher Pill */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {showPreviousLine && previousSegment && (
                    <p
                      style={{ fontSize: `${Math.max(15, Math.round(previousFontSize * 0.85))}px` }}
                      className="text-[#64748B] dark:text-[#94A3B8] truncate mb-0.5"
                    >
                      {previousSegment.english}
                    </p>
                  )}
                  <p
                    style={{ fontSize: `${Math.max(20, Math.round(fontSize * 0.82))}px` }}
                    className={`font-semibold caption-text-ltr ${
                      interimTranscript.trim().length > 0 ? 'italic opacity-70' : ''
                    }`}
                  >
                    {interimTranscript.trim().length > 0 || currentSegment ? (
                      <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                        {interimTranscript.trim().length > 0
                          ? interimTranscript
                          : currentSegment?.english}
                      </CaptionText>
                    ) : (
                      <span className="text-[#64748B] dark:text-[#94A3B8]">
                        {isListening
                          ? 'Listening for teacher speech…'
                          : 'Press Start Listening (or Spacebar) to show live subtitles.'}
                      </span>
                    )}
                  </p>
                </div>

                {/* Target Language Switcher when >1 language is checked */}
                {selectedLangs.length > 1 && (
                  <div className="flex items-center gap-1 p-1 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] shrink-0">
                    {selectedLangs.map((code, langIndex) => {
                      const cfg = LANGUAGE_MAP[code];
                      const active = code === activeSubtitleLang;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setSubtitleLang(code)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-[#5843A5] dark:bg-[#6D56C6] text-white'
                              : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                          }`}
                        >
                          <CaptionSwatch color={languageCaptionColor(langIndex)} />
                          {cfg.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Row: Chosen Target Language Translation */}
              <div
                dir={LANGUAGE_MAP[activeSubtitleLang].dir}
                className="border-t border-[#E2E8F0] dark:border-[#1E293B] pt-2"
              >
                {interimTranscript.trim().length > 0 &&
                liveTranslations[activeSubtitleLang] ? (
                  <p
                    style={{ fontSize: `${fontSize}px` }}
                    className={`font-bold italic opacity-70 ${
                      LANGUAGE_MAP[activeSubtitleLang].dir === 'rtl'
                        ? 'caption-text-rtl'
                        : 'caption-text-ltr'
                    }`}
                  >
                    <CaptionText color={subtitleCaptionColor} isDark={isDark}>
                      {liveTranslations[activeSubtitleLang]}
                    </CaptionText>
                  </p>
                ) : currentSegment ? (
                  currentSegment.status === 'translating' &&
                  !currentSegment.translations[activeSubtitleLang] ? (
                    <p
                      style={{ fontSize: `${fontSize}px` }}
                      className="font-semibold text-[#64748B] dark:text-[#94A3B8] animate-pulse"
                    >
                      Translating…
                    </p>
                  ) : currentSegment.translations[activeSubtitleLang] ===
                    'translation unavailable' ? (
                    <p
                      dir="ltr"
                      className="text-base font-medium text-amber-600 dark:text-amber-400 italic"
                    >
                      translation unavailable
                    </p>
                  ) : (
                    <p
                      style={{ fontSize: `${fontSize}px` }}
                      className={`font-bold ${
                        LANGUAGE_MAP[activeSubtitleLang].dir === 'rtl'
                          ? 'caption-text-rtl'
                          : 'caption-text-ltr'
                      }`}
                    >
                      <CaptionText color={subtitleCaptionColor} isDark={isDark}>
                        {currentSegment.translations[activeSubtitleLang]}
                      </CaptionText>
                    </p>
                  )
                ) : (
                  <p
                    dir="ltr"
                    className="text-sm text-[#64748B] dark:text-[#94A3B8]"
                  >
                    {LANGUAGE_MAP[activeSubtitleLang].name} subtitle line
                  </p>
                )}
              </div>
            </div>
          </section>
        </main>
      )}

      </>}
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
        onClosePip={() => {
          if (pipWindow && !pipWindow.closed) {
            pipWindow.close();
          }
          setPipWindow(null);
        }}
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
