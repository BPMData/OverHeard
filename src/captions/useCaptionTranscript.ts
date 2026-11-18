import { useCallback, useRef, useState, type FormEvent, type RefObject } from 'react';
import { formatTimestamp, LIVE_INTERIM_TRANSLATION } from '../app/settings';
import type { LectureEntry } from '../conversation/lectureState';
import { formatLectureFilename } from '../rooms/LectureFiles';
import { roomJson } from '../rooms/protocol';
import type { CaptionSegment, LanguageCode } from '../types';
import { useLiveTranslations } from '../useLiveTranslations';
import { refineCaption } from '../translation/refine';
import type { useTranslator } from '../translation/useTranslator';

type TranscriptOptions = Pick<ReturnType<typeof useTranslator>,
  'fetchMT' | 'getMtProvider' | 'fetchTranslationWithRetry' | 'mtPreferenceRef'
> & {
  selectedLangs: LanguageCode[];
  selectedLangsRef: RefObject<LanguageCode[]>;
  stopColumnPlayback: () => void;
  refineEnabledRef: RefObject<boolean>;
  geminiRefineEnabledRef: RefObject<boolean>;
};

export function useCaptionTranscript({
  selectedLangs, selectedLangsRef, stopColumnPlayback, fetchMT, getMtProvider,
  fetchTranslationWithRetry, mtPreferenceRef, refineEnabledRef, geminiRefineEnabledRef,
}: TranscriptOptions) {
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  // Transcript store
  const [segments, setSegments] = useState<CaptionSegment[]>([]);

  // Silent testing input
  const [manualInput, setManualInput] = useState<string>('');

  const nextIdRef = useRef<number>(1);
  const finalizedHistoryRef = useRef<string[]>([]);
  // Live (interim) translation state
  // Bumped whenever a phrase is finalized or the transcript is cleared: starts a new live utterance
  const [liveSegment, setLiveSegment] = useState(0);

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

        await refineCaption({
          phrase, langs, contextSnapshot, preference: mtPreferenceRef.current,
          refineEnabled: refineEnabledRef.current && geminiRefineEnabledRef.current,
          getMtProvider, fetchTranslationWithRetry, patch,
        });
      });
    },
    [fetchMT, fetchTranslationWithRetry, getMtProvider, mtPreferenceRef, refineEnabledRef, geminiRefineEnabledRef, selectedLangsRef]
  );

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
  const handleManualSubmit = (e: FormEvent) => {
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

  const currentSegment =
    segments.length > 0 ? segments[segments.length - 1] : null;
  const previousSegment =
    segments.length > 1 ? segments[segments.length - 2] : null;

  return {
    segments, currentSegment, previousSegment, handleFinalizedPhrase,
    interimTranscript, setInterimTranscript, clearLiveTranslation, liveTranslations,
    confirmClear, setConfirmClear, handleClearConfirm, handleExportJson,
    manualInput, setManualInput, handleManualSubmit, handleBurstTest,
  };
}
