import { useEffect, useMemo, useRef, useState } from 'react';
import { continuesSpeech, liveChunks } from './liveTranslation';

/** Minimum gap between snapshots of the interim text sent for translation. */
export const LIVE_THROTTLE_MS = 350;

const NONE: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Throttle (not debounce) a changing string: during continuous speech it still updates
 * every `ms`, instead of waiting for the speaker to pause. Clearing the text or changing
 * `resetKey` applies immediately.
 */
export function useThrottledText(text: string, ms: number, resetKey = ''): string {
  const [state, setState] = useState({ text, key: resetKey });
  const lastAt = useRef(0);
  useEffect(() => {
    if (text === state.text && resetKey === state.key) return;
    const apply = () => {
      lastAt.current = Date.now();
      setState({ text, key: resetKey });
    };
    if (!text || resetKey !== state.key) {
      apply();
      // The first words of the next utterance go out without waiting
      if (!text) lastAt.current = 0;
      return;
    }
    const wait = lastAt.current + ms - Date.now();
    if (wait <= 0) {
      apply();
      return;
    }
    const timer = setTimeout(apply, wait);
    return () => clearTimeout(timer);
  }, [text, resetKey, state, ms]);
  // Never hand back the previous utterance's text under a new key
  return state.key === resetKey ? state.text : '';
}

interface ChunkResult {
  source: string;
  translation: string;
}

/**
 * Simultaneous ("UN-style") translation of an interim transcript that may run for a long
 * time without a pause.
 *
 * - The interim is split into stable word chunks; finished chunks are translated once and
 *   only the open tail is retranslated, so request size stays bounded.
 * - Each chunk keeps showing its last translation while a newer one is in flight
 *   (stale-while-revalidate), so captions never blank out while the speaker keeps talking.
 * - At most one request per language and chunk is in flight. A slow provider is therefore
 *   asked for the newest text when it finishes, rather than queuing every intermediate text.
 *
 * `segmentKey` identifies the current utterance (e.g. the last finalized entry id); a new
 * key or an empty interim discards the previous utterance's chunks.
 */
export function useLiveTranslations<L extends string>(
  text: string,
  requestedLangs: readonly L[],
  translate: (text: string, lang: L) => Promise<string>,
  segmentKey: string,
): Partial<Record<L, string>> {
  // Callers often pass a fresh array each render; key on its contents instead
  const langKey = requestedLangs.join(',');
  const langs = useMemo(() => requestedLangs, [langKey]);
  const throttled = useThrottledText(text.trim(), LIVE_THROTTLE_MS, segmentKey);
  const results = useRef(new Map<string, ChunkResult>());
  const failed = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);
  const segment = useRef(segmentKey);
  const [version, bump] = useState(0);

  if (segment.current !== segmentKey) {
    // Render-time reset so the new utterance never shows the old one's chunks
    segment.current = segmentKey;
    generation.current += 1;
    results.current.clear();
    failed.current.clear();
    inFlight.current.clear();
  }

  const chunks = useMemo(() => liveChunks(throttled), [throttled]);
  // Display is checked against what is on screen now, not the throttled request text
  const shownChunks = useMemo(() => liveChunks(text), [text]);

  useEffect(() => {
    if (chunks.length === 0) {
      generation.current += 1;
      results.current.clear();
      failed.current.clear();
      inFlight.current.clear();
      return;
    }
    const startedGeneration = generation.current;
    for (const lang of langs) {
      chunks.forEach((chunk, index) => {
        const key = `${lang}\0${index}`;
        if (results.current.get(key)?.source === chunk) return;
        if (failed.current.get(key) === chunk || inFlight.current.has(key)) return;
        inFlight.current.add(key);
        translate(chunk, lang).then(
          (translation) => {
            if (generation.current !== startedGeneration) return;
            inFlight.current.delete(key);
            results.current.set(key, { source: chunk, translation });
            failed.current.delete(key);
            bump((value) => value + 1);
          },
          () => {
            // Best effort: finalized lines report failures. Retry once this chunk changes.
            if (generation.current !== startedGeneration) return;
            inFlight.current.delete(key);
            failed.current.set(key, chunk);
            bump((value) => value + 1);
          },
        );
      });
    }
  }, [chunks, langs, translate, version]);

  return useMemo(() => {
    if (shownChunks.length === 0) return NONE as Partial<Record<L, string>>;
    const output: Partial<Record<L, string>> = {};
    for (const lang of langs) {
      const parts: string[] = [];
      for (let index = 0; index < shownChunks.length; index += 1) {
        const result = results.current.get(`${lang}\0${index}`);
        // Stale-while-revalidate, but only while the words still continue that source
        if (result && continuesSpeech(result.source, shownChunks[index])) parts.push(result.translation);
      }
      if (parts.length) output[lang] = parts.join(' ');
    }
    return output;
    // `version` marks new results in the mutable map
  }, [shownChunks, langs, version, segmentKey]);
}
