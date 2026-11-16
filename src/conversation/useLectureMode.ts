import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { shouldSendImmediately } from '../liveTranslation';
import { withMicAccess, type MicBlock } from '../micPermission';
import {
  isOnDeviceTranslationSupported,
  prepareOnDeviceTranslators,
  type PackProgress,
} from '../onDevice';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { LectureEntry } from './lectureState';
import {
  createLectureEntry,
  lectureCsv,
  lectureReducer,
  loadLectureEntries,
  saveLectureEntries,
} from './lectureState';
import { useLectureSpeech } from './useLectureSpeech';

const LIVE_DEBOUNCE_MS = 450;
const LIVE_WORD_STEP = 6;
const NO_LIVE_TRANSLATIONS: Partial<Record<LanguageCode, string>> = {};

export interface UseLectureModeOptions {
  active: boolean;
  selectedLangs: LanguageCode[];
  mtPreference: string;
  translate: (
    text: string,
    target: ConversationLanguage,
    source: ConversationLanguage,
  ) => Promise<string>;
  onStartAttempt?: () => void;
  onPermissionDenied: (reason?: MicBlock) => void;
  onPackProgress?: PackProgress;
}

export function useLectureMode({
  active,
  selectedLangs,
  mtPreference,
  translate,
  onStartAttempt,
  onPermissionDenied,
  onPackProgress,
}: UseLectureModeOptions) {
  const [entries, dispatch] = useReducer(lectureReducer, undefined, loadLectureEntries);
  const [liveResult, setLiveResult] = useState<{ english: string; translations: Partial<Record<LanguageCode, string>> }>({
    english: '', translations: NO_LIVE_TRANSLATIONS,
  });
  const [uiError, setUiError] = useState('');

  const selectedLangsRef = useRef(selectedLangs);
  selectedLangsRef.current = selectedLangs;

  const liveTimerRef = useRef<number | null>(null);
  const liveSentTextRef = useRef('');
  const liveSeqRef = useRef(0);
  const liveClearedAtSeqRef = useRef(0);
  const liveAppliedSeqRef = useRef<Record<string, number>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const generation = useRef(0);

  const clearLiveTranslation = useCallback(() => {
    if (liveTimerRef.current !== null) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    liveClearedAtSeqRef.current = liveSeqRef.current;
    liveSentTextRef.current = '';
    setLiveResult({ english: '', translations: NO_LIVE_TRANSLATIONS });
  }, []);

  const addLine = useCallback(
    (rawText: string) => {
      clearLiveTranslation();
      const phrase = rawText.trim().slice(0, 500);
      if (!phrase) return;
      dispatch({ type: 'add', entry: createLectureEntry(phrase) });
    },
    [clearLiveTranslation],
  );

  const speech = useLectureSpeech({
    onFinal: addLine,
    onPermissionDenied,
  });
  const currentEnglish = useRef('');
  currentEnglish.current = speech.interim.trim();
  const liveTranslations = liveResult.english === currentEnglish.current
    ? liveResult.translations : NO_LIVE_TRANSLATIONS;

  // Persist finalized lecture entries locally in the browser until explicitly cleared
  useEffect(() => {
    saveLectureEntries(entries);
  }, [entries]);

  // Stop active lecture microphone if user leaves Lecture mode or closes Conversation view
  useEffect(() => {
    if (!active) {
      speech.stop();
      clearLiveTranslation();
    }
  }, [active, speech.stop, clearLiveTranslation]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (liveTimerRef.current !== null) {
        window.clearTimeout(liveTimerRef.current);
      }
    };
  }, []);

  const sendLiveTranslation = useCallback(
    (text: string) => {
      liveSentTextRef.current = text;
      const seq = ++liveSeqRef.current;
      for (const code of selectedLangsRef.current) {
        void translate(text, code, 'en').then(
          (translation) => {
            if (currentEnglish.current !== text) return;
            if (seq <= liveClearedAtSeqRef.current) return;
            if (seq < (liveAppliedSeqRef.current[code] ?? 0)) return;
            liveAppliedSeqRef.current[code] = seq;
            setLiveResult((prev) => ({ english: text,
              translations: { ...(prev.english === text ? prev.translations : {}), [code]: translation } }));
          },
          () => {
            // Interim streaming is best-effort; finalized rows record unavailable state
          },
        );
      }
    },
    [translate],
  );

  // Stream live translations as English interim transcript updates
  useEffect(() => {
    if (!active) return;
    const text = speech.interim.trim();
    if (!text) {
      clearLiveTranslation();
      return;
    }
    if (text === liveSentTextRef.current) return;

    if (liveTimerRef.current !== null) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }

    if (shouldSendImmediately(text, liveSentTextRef.current, LIVE_WORD_STEP)) {
      sendLiveTranslation(text);
      return;
    }

    liveTimerRef.current = window.setTimeout(() => {
      liveTimerRef.current = null;
      sendLiveTranslation(text);
    }, LIVE_DEBOUNCE_MS);
  }, [active, speech.interim, clearLiveTranslation, sendLiveTranslation]);

  // Translate any finalized lecture entries for all active target languages (including newly added languages)
  useEffect(() => {
    if (!active) return;
    for (const entry of entries) {
      for (const code of selectedLangs) {
        if (entry.translations[code] || entry.failedLangs[code]) continue;
        const key = `${entry.id}:${code}`;
        if (inFlightRef.current.has(key)) continue;
        inFlightRef.current.add(key);
        const startedGeneration = generation.current;
        void translate(entry.english, code, 'en').then(
          (translation) => {
            if (generation.current !== startedGeneration) return;
            inFlightRef.current.delete(key);
            dispatch({ type: 'resolve', id: entry.id, lang: code, translation });
          },
          () => {
            if (generation.current !== startedGeneration) return;
            inFlightRef.current.delete(key);
            dispatch({ type: 'resolve', id: entry.id, lang: code, translation: null });
          },
        );
      }
    }
  }, [active, entries, selectedLangs, translate]);

  const start = useCallback(() => {
    onStartAttempt?.();
    setUiError('');
    if (mtPreference === 'on-device' || (mtPreference === 'auto' && isOnDeviceTranslationSupported())) {
      prepareOnDeviceTranslators(selectedLangs, onPackProgress);
    }
    withMicAccess(
      () => speech.start(mtPreference === 'on-device'),
      (reason) => onPermissionDenied(reason),
    );
  }, [mtPreference, selectedLangs, onPackProgress, onStartAttempt, onPermissionDenied, speech]);

  const stop = useCallback(() => {
    speech.stop();
    clearLiveTranslation();
  }, [speech, clearLiveTranslation]);

  const clear = useCallback(() => {
    if (window.confirm('Clear the entire lecture transcript?')) {
      generation.current++;
      inFlightRef.current.clear();
      clearLiveTranslation();
      dispatch({ type: 'clear' });
    }
  }, [clearLiveTranslation]);

  const replace = useCallback((entries: LectureEntry[]) => {
    speech.stop();
    generation.current++;
    clearLiveTranslation();
    inFlightRef.current.clear();
    dispatch({ type: 'replace', entries: entries.map(entry => ({ ...entry,
      id: crypto.randomUUID(), failedLangs: {} })) });
  }, [speech.stop, clearLiveTranslation]);

  const exportCsv = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([lectureCsv(entries, selectedLangs)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `lecture-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [entries, selectedLangs]);

  return {
    entries,
    speech,
    liveTranslations,
    uiError,
    setUiError,
    addLine,
    start,
    stop,
    clear,
    replace,
    exportCsv,
  };
}
