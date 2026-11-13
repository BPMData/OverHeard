/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  Subtitles,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LANGUAGES,
  FONT_STEP,
  LANGUAGE_MAP,
  MAX_FONT_SIZE,
  MAX_LANGUAGES,
  MIN_FONT_SIZE,
  SAMPLE_SENTENCES,
  VALID_LANGUAGE_CODES,
} from './constants';
import { CaptionSegment, DisplayMode, LanguageCode } from './types';
import { LanguageModal } from './components/LanguageModal';
import { AboutModal } from './components/AboutModal';
import { PipSubtitlePortal } from './components/PipSubtitlePortal';

// Web Speech API TypeScript definitions
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    documentPictureInPicture?: {
      requestWindow: (options?: {
        width?: number;
        height?: number;
      }) => Promise<Window>;
      window?: Window | null;
    };
  }
}

function parseInitialLanguages(): LanguageCode[] {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGES;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('langs');
  if (!raw) return DEFAULT_LANGUAGES;

  const codes = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((code): code is LanguageCode => VALID_LANGUAGE_CODES.has(code));

  const unique = Array.from(new Set(codes)).slice(0, MAX_LANGUAGES);
  return unique.length > 0 ? unique : DEFAULT_LANGUAGES;
}

function formatTimestamp(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('columns');

  // Modals & drawers
  const [isLangModalOpen, setIsLangModalOpen] = useState<boolean>(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState<boolean>(false);
  const [isTestBarOpen, setIsTestBarOpen] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  // Speech recognition & permission states
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [micPermissionDenied, setMicPermissionDenied] = useState<boolean>(false);
  const [speechStatusNotice, setSpeechStatusNotice] = useState<string | null>(null);

  // Transcript store
  const [segments, setSegments] = useState<CaptionSegment[]>([]);

  // Silent testing input
  const [manualInput, setManualInput] = useState<string>('');

  // Document Picture-in-Picture window state
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipNotice, setPipNotice] = useState<string | null>(null);

  // Environment checks
  const [isSupportedBrowser, setIsSupportedBrowser] = useState<boolean>(true);
  const [hasSpeechApi, setHasSpeechApi] = useState<boolean>(true);
  const [hasPipApi, setHasPipApi] = useState<boolean>(false);
  const [isEmbeddedIframe, setIsEmbeddedIframe] = useState<boolean>(false);

  // Refs for synchronous access in event callbacks & concurrency tracking
  const userStoppedRef = useRef<boolean>(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const nextIdRef = useRef<number>(1);
  const selectedLangsRef = useRef<LanguageCode[]>(selectedLangs);
  const finalizedHistoryRef = useRef<string[]>([]);
  const inFlightCountRef = useRef<number>(0);
  const backlogBufferRef = useRef<{
    texts: string[];
    contextSnapshot: string[];
  } | null>(null);

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
        'bg-[#090D16] text-[#F8FAFC] antialiased selection:bg-sky-500/30';
    } else {
      root.classList.remove('dark');
      document.body.className =
        'bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-sky-500/20';
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

  // Low-level fetch with 1-second single retry
  const fetchTranslationWithRetry = useCallback(
    async (
      phrase: string,
      targetLangs: LanguageCode[],
      context: string[]
    ): Promise<Record<string, string>> => {
      const attemptFetch = async (): Promise<Record<string, string>> => {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phrase: phrase.slice(0, 500),
            targetLangs,
            context,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          translations?: Record<string, string>;
        };
        if (!data.translations) {
          throw new Error('Missing translations payload');
        }
        return data.translations;
      };

      try {
        return await attemptFetch();
      } catch {
        // Retry once after 1 second before giving up
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await attemptFetch();
      }
    },
    []
  );

  // Dispatch a single segment ID to /api/translate and drain any merged backlog when a slot frees up
  const dispatchSegmentTranslation = useCallback(
    async (
      segmentId: number,
      englishText: string,
      langsSnapshot: LanguageCode[],
      contextSnapshot: string[]
    ) => {
      inFlightCountRef.current += 1;

      try {
        const translations = await fetchTranslationWithRetry(
          englishText,
          langsSnapshot,
          contextSnapshot
        );

        setSegments((prev) =>
          prev.map((seg) =>
            seg.id === segmentId
              ? {
                  ...seg,
                  translations,
                  status: 'done',
                }
              : seg
          )
        );
      } catch {
        const unavailableMap: Record<string, string> = {};
        for (const code of langsSnapshot) {
          unavailableMap[code] = 'translation unavailable';
        }
        setSegments((prev) =>
          prev.map((seg) =>
            seg.id === segmentId
              ? {
                  ...seg,
                  translations: unavailableMap,
                  status: 'error',
                }
              : seg
          )
        );
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);

        // Backlog guard drain: if phrases accumulated while >4 requests were in flight, flush merged request now
        if (inFlightCountRef.current < 4 && backlogBufferRef.current) {
          const buffered = backlogBufferRef.current;
          backlogBufferRef.current = null;

          const mergedEnglish = buffered.texts.join(' ').slice(0, 500);
          const mergedId = nextIdRef.current++;
          const activeLangs = [...selectedLangsRef.current];

          const newSegment: CaptionSegment = {
            id: mergedId,
            timestamp: formatTimestamp(),
            english: mergedEnglish,
            translations: {},
            status: 'translating',
          };

          setSegments((prev) => [...prev, newSegment]);
          void dispatchSegmentTranslation(
            mergedId,
            mergedEnglish,
            activeLangs,
            buffered.contextSnapshot
          );
        }
      }
    },
    [fetchTranslationWithRetry]
  );

  // Enqueue a finalized English phrase (concurrent dispatch + >4 in-flight backlog merge guard)
  const handleFinalizedPhrase = useCallback(
    (rawPhrase: string) => {
      const cleaned = rawPhrase.trim();
      if (!cleaned) return;

      const phrase = cleaned.slice(0, 500);
      const contextSnapshot = finalizedHistoryRef.current.slice(-2);
      finalizedHistoryRef.current = [
        ...finalizedHistoryRef.current.slice(-20),
        phrase,
      ];

      // Backlog guard: if 4 or more requests are already in flight, merge newly finalized phrases into one request
      if (inFlightCountRef.current >= 4) {
        if (backlogBufferRef.current) {
          backlogBufferRef.current.texts.push(phrase);
        } else {
          backlogBufferRef.current = {
            texts: [phrase],
            contextSnapshot,
          };
        }
        return;
      }

      const segmentId = nextIdRef.current++;
      const langsSnapshot = [...selectedLangsRef.current];

      const newSegment: CaptionSegment = {
        id: segmentId,
        timestamp: formatTimestamp(),
        english: phrase,
        translations: {},
        status: 'translating',
      };

      setSegments((prev) => [...prev, newSegment]);
      void dispatchSegmentTranslation(
        segmentId,
        phrase,
        langsSnapshot,
        contextSnapshot
      );
    },
    [dispatchSegmentTranslation]
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

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechStatusNotice(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcriptText = result[0]?.transcript || '';
          if (result.isFinal) {
            setInterimTranscript('');
            handleFinalizedPhrase(transcriptText);
          } else {
            interim += transcriptText;
          }
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const errCode = event.error;
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
        if (!userStoppedRef.current) {
          try {
            recognition.start();
          } catch {
            // Ignore InvalidStateError when already running
          }
        } else {
          setIsListening(false);
          setInterimTranscript('');
        }
      };

      recognitionRef.current = recognition;
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      // Ignore InvalidStateError if already running
      setIsListening(true);
    }
  }, [handleFinalizedPhrase]);

  const stopListening = useCallback(() => {
    userStoppedRef.current = true;
    setIsListening(false);
    setInterimTranscript('');
    setSpeechStatusNotice(null);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      userStoppedRef.current = true;
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
      if (e.code !== 'Space') return;
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
  }, [toggleListening]);

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
      const win = await window.documentPictureInPicture.requestWindow({
        width: 920,
        height: 230,
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

  // UTF-8 BOM CSV Transcript Download
  const handleDownloadCsv = () => {
    if (segments.length === 0) return;

    const escapeCsvCell = (val: string): string => {
      const escaped = val.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const headers = [
      'Timestamp',
      'English',
      ...selectedLangs.map((code) => `${LANGUAGE_MAP[code].name} (${code})`),
    ];

    const rows = segments.map((seg) => [
      escapeCsvCell(seg.timestamp),
      escapeCsvCell(seg.english),
      ...selectedLangs.map((code) =>
        escapeCsvCell(seg.translations[code] || '')
      ),
    ]);

    const csvContent =
      '\uFEFF' +
      [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join(
        '\r\n'
      );

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `overheard-transcript-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Clear transcript history
  const handleClearConfirm = () => {
    setSegments([]);
    setInterimTranscript('');
    finalizedHistoryRef.current = [];
    backlogBufferRef.current = null;
    setConfirmClear(false);
  };

  // Submit silent test sentence
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleFinalizedPhrase(manualInput);
    setManualInput('');
  };

  // Burst test (5 rapid sentences to test concurrent in-order slots + >4 in-flight backlog guard)
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

  const currentSegment =
    segments.length > 0 ? segments[segments.length - 1] : null;
  const previousSegment =
    segments.length > 1 ? segments[segments.length - 2] : null;
  const previousFontSize = Math.max(16, Math.round(fontSize * 0.68));
  const activeSubtitleLang = selectedLangs.includes(subtitleLang)
    ? subtitleLang
    : selectedLangs[0];

  const gridColsClass =
    selectedLangs.length === 1
      ? 'grid-cols-1 lg:grid-cols-2'
      : selectedLangs.length === 2
      ? 'grid-cols-1 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#090D16] text-[#0F172A] dark:text-[#F8FAFC] transition-colors">
      {/* Browser Compatibility Banner */}
      {(!isSupportedBrowser || !hasSpeechApi) && (
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

      {/* Microphone Permission Banner */}
      {micPermissionDenied && (
        <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-3 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-2.5 text-red-800 dark:text-red-200">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5 sm:mt-0" />
            <div>
              <strong>Microphone Permission Blocked:</strong> Chrome could not access your microphone. Click the tune/lock icon in your browser&apos;s address bar, set{' '}
              <strong>Microphone</strong> to <strong>Allow</strong>, and press{' '}
              <strong>Start Listening</strong> again.
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
      )}

      {/* Pip Notice Banner */}
      {pipNotice && (
        <div className="bg-sky-500/15 border-b border-sky-500/30 px-4 py-2 text-xs flex items-center justify-between gap-4 text-sky-900 dark:text-sky-200">
          <span>{pipNotice}</span>
          <div className="flex items-center gap-2 shrink-0">
            {isEmbeddedIframe && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 font-semibold"
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

      {/* Top Teacher Control Bar */}
      <header className="border-b border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] px-4 lg:px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Brand & Primary Start/Stop Mic Action */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap">
                  OverHeard
                </span>
                <span className="hidden xl:inline-block text-xs text-[#64748B] dark:text-[#94A3B8] whitespace-nowrap">
                  · OverBoard · AllAboard · OverHeard
                </span>
              </div>
            </div>

            {/* Primary Start/Stop Button + Pulsing Mic Indicator */}
            <button
              type="button"
              onClick={toggleListening}
              className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-xs ${
                isListening
                  ? 'bg-[#059669] dark:bg-[#10B981] text-white dark:text-slate-950 ring-4 ring-emerald-500/25'
                  : 'bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 hover:opacity-95'
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
                  ? 'border-[#0284C7] dark:border-[#38BDF8] bg-sky-500/10 text-[#0284C7] dark:text-[#38BDF8]'
                  : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
              }`}
              title="Show or hide the preceding caption line"
            >
              <History className="w-3.5 h-3.5" />
              <span>Prev Line</span>
            </button>

            {/* Columns vs Subtitle Mode */}
            <div className="inline-flex items-center rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] p-0.5">
              <button
                type="button"
                onClick={() => setDisplayMode('columns')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  displayMode === 'columns'
                    ? 'bg-white dark:bg-[#111827] text-[#0F172A] dark:text-[#F8FAFC] shadow-2xs'
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
                    ? 'bg-white dark:bg-[#111827] text-[#0F172A] dark:text-[#F8FAFC] shadow-2xs'
                    : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                <Subtitles className="w-3.5 h-3.5" />
                <span>Subtitle</span>
              </button>
            </div>

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
              <Globe className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
              <span>Languages</span>
              <span className="font-mono text-[#64748B] dark:text-[#94A3B8]">
                ({selectedLangs.join(', ')})
              </span>
            </button>

            {/* Silent Test Input Bar Toggle */}
            <button
              type="button"
              onClick={() => setIsTestBarOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                isTestBarOpen
                  ? 'border-[#0284C7] dark:border-[#38BDF8] bg-sky-500/10 text-[#0284C7] dark:text-[#38BDF8]'
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

            {/* Download Transcript CSV */}
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={segments.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title="Download CSV transcript with UTF-8 BOM"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV</span>
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

            {/* About / Privacy Modal Button */}
            <button
              type="button"
              onClick={() => setIsAboutModalOpen(true)}
              className="p-2 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="About OverHeard and Privacy Statement"
              title="About OverHeard & Privacy Notice"
            >
              <HelpCircle className="w-4 h-4" />
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
                className="flex-1 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] px-3.5 py-2 text-sm text-[#0F172A] dark:text-[#F8FAFC] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:border-[#0284C7] dark:focus:border-[#38BDF8]"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 text-xs font-bold disabled:opacity-40 transition-opacity whitespace-nowrap"
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
                  className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] hover:border-[#0284C7] dark:hover:border-[#38BDF8] transition-colors whitespace-nowrap"
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
                      className="font-bold text-[#0F172A] dark:text-[#F8FAFC] caption-text-ltr tracking-tight"
                    >
                      {currentSegment.english}
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
                      <span className="inline-block text-xs font-mono text-[#0284C7] dark:text-[#38BDF8] mb-1">
                        Speaking live…
                      </span>
                      <p
                        style={{ fontSize: `${fontSize}px` }}
                        className="font-semibold text-[#64748B] dark:text-[#94A3B8] italic caption-text-ltr"
                      >
                        {interimTranscript}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Target Language Columns (up to 3) */}
            {selectedLangs.map((code) => {
              const lang = LANGUAGE_MAP[code];
              const isRtl = lang.dir === 'rtl';
              const prevText = previousSegment?.translations[code];
              const currText = currentSegment?.translations[code];
              const isTranslating =
                currentSegment?.status === 'translating' && !currText;
              const isUnavailable = currText === 'translation unavailable';

              return (
                <section
                  key={code}
                  aria-label={`${lang.name} Translation`}
                  className="flex flex-col rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold tracking-tight text-[#0284C7] dark:text-[#38BDF8]">
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
                    <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                      {code}
                    </span>
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
                            className={`font-bold text-[#0F172A] dark:text-[#F8FAFC] tracking-tight ${
                              isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                            }`}
                          >
                            {currText}
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 text-xs font-bold whitespace-nowrap"
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
                      className="text-[#0284C7] dark:text-[#38BDF8]"
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
            className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-[#0284C7]/40 dark:border-[#38BDF8]/40 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md px-6 py-4 shadow-2xl"
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
                      interimTranscript.trim().length > 0
                        ? 'text-[#64748B] dark:text-[#94A3B8] italic'
                        : 'text-[#0F172A] dark:text-[#F8FAFC]'
                    }`}
                  >
                    {interimTranscript.trim().length > 0
                      ? interimTranscript
                      : currentSegment?.english ||
                        (isListening
                          ? 'Listening for teacher speech…'
                          : 'Press Start Listening (or Spacebar) to show live subtitles.')}
                  </p>
                </div>

                {/* Target Language Switcher when >1 language is checked */}
                {selectedLangs.length > 1 && (
                  <div className="flex items-center gap-1 p-1 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] shrink-0">
                    {selectedLangs.map((code) => {
                      const cfg = LANGUAGE_MAP[code];
                      const active = code === activeSubtitleLang;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setSubtitleLang(code)}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950'
                              : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                          }`}
                        >
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
                {currentSegment ? (
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
                      className={`font-bold text-[#0284C7] dark:text-[#38BDF8] ${
                        LANGUAGE_MAP[activeSubtitleLang].dir === 'rtl'
                          ? 'caption-text-rtl'
                          : 'caption-text-ltr'
                      }`}
                    >
                      {currentSegment.translations[activeSubtitleLang]}
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

      {/* Modals & Portals */}
      <LanguageModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
        selectedLangs={selectedLangs}
        onToggleLang={handleToggleLanguage}
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
        subtitleLang={activeSubtitleLang}
        onSelectSubtitleLang={setSubtitleLang}
        currentSegment={currentSegment}
        interimTranscript={interimTranscript}
      />
    </div>
  );
}
