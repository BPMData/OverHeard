import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { withMicAccess, type MicBlock } from '../micPermission';
import {
  isOnDeviceTranslationSupported,
  prepareOfflineSpeechIfTranslatorsReady,
  prepareOnDeviceTranslators,
  type PackProgress,
} from '../onDevice';
import { speechLocality } from '../offline';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { LectureEntry } from './lectureState';
import { createLectureEntry, lectureReducer, loadLectureEntries, saveLectureEntries } from './lectureState';
import { useLectureSpeech } from './useLectureSpeech';
import { useLiveTranslations } from '../useLiveTranslations';

export interface UseLectureModeOptions {
  active: boolean;
  selectedLangs: LanguageCode[];
  mtPreference: string;
  translate: (
    text: string,
    target: ConversationLanguage,
    source: ConversationLanguage,
    options?: { live?: boolean }
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
  const [uiError, setUiError] = useState('');

  const inFlightRef = useRef<Set<string>>(new Set());
  const generation = useRef(0);

  const addLine = useCallback((rawText: string) => {
    const phrase = rawText.trim().slice(0, 500);
    if (!phrase) return;
    dispatch({ type: 'add', entry: createLectureEntry(phrase) });
  }, []);

  const speech = useLectureSpeech({
    onFinal: addLine,
    onPermissionDenied,
  });
  const translateLive = useCallback(
    (text: string, code: LanguageCode) => translate(text, code, 'en', { live: true }),
    [translate]
  );
  const lastEntryId = entries.length ? entries[entries.length - 1].id : '';
  const liveTranslations = useLiveTranslations(active ? speech.interim : '', selectedLangs, translateLive, lastEntryId);

  // Persist finalized lecture entries locally in the browser until explicitly cleared
  useEffect(() => {
    saveLectureEntries(entries);
  }, [entries]);

  // Stop active lecture microphone if user leaves Lecture mode or closes Conversation view
  useEffect(() => {
    if (!active) {
      speech.stop();
    }
  }, [active, speech.stop]);

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
          }
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
    if (mtPreference === 'auto') {
      // Speech stays on Google's free service while online. Fetch the on-device pack during
      // this click (installs need one) so speech can switch over if the network drops.
      prepareOfflineSpeechIfTranslatorsReady(
        isOnDeviceTranslationSupported() ? selectedLangs.map((code) => ({ code, source: 'en' })) : [],
        [{ key: 'speech', locale: 'en-US' }],
        onPackProgress
      );
    }
    withMicAccess(
      () => speech.start(speechLocality(mtPreference)),
      (reason) => onPermissionDenied(reason)
    );
  }, [mtPreference, selectedLangs, onPackProgress, onStartAttempt, onPermissionDenied, speech]);

  const stop = useCallback(() => {
    speech.stop();
  }, [speech]);

  const clear = useCallback(() => {
    if (window.confirm('Clear the entire lecture transcript?')) {
      generation.current++;
      inFlightRef.current.clear();
      dispatch({ type: 'clear' });
    }
  }, []);

  const replace = useCallback(
    (nextEntries: LectureEntry[], options?: { preserveIds?: boolean }) => {
      speech.stop();
      generation.current++;
      inFlightRef.current.clear();
      dispatch({
        type: 'replace',
        entries: options?.preserveIds
          ? nextEntries
          : nextEntries.map((entry) => ({
              ...entry,
              id: crypto.randomUUID(),
              failedLangs: {},
            })),
      });
    },
    [speech.stop]
  );

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
  };
}
