// Simultaneous read-aloud: decide which words of a still-changing interim transcript are
// settled enough to translate and speak before the speaker pauses.

/** Words unchanged for this long are treated as final enough to speak. */
export const LIVE_SPEECH_STABLE_MS = 700;
/** Speak once at least this many settled words are waiting… */
export const LIVE_SPEECH_MIN_WORDS = 4;
/** …or fewer, once they have waited this long (the speaker slowed down). */
export const LIVE_SPEECH_LINGER_MS = 2000;
/** Longest piece spoken at once, so audio starts quickly after a burst of words. */
export const LIVE_SPEECH_MAX_WORDS = 14;

export interface WordTracker {
  words: string[];
  /** When each word last changed (ms). */
  changedAt: number[];
}

export const emptyTracker = (): WordTracker => ({ words: [], changedAt: [] });

export const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

const sameWord = (a: string, b: string) =>
  a.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Record a new interim transcript, keeping the timestamps of words that did not change. */
export function trackWords(previous: WordTracker, text: string, now: number): WordTracker {
  const words = splitWords(text);
  const changedAt = words.map((word, index) =>
    index < previous.words.length && sameWord(previous.words[index], word) ? previous.changedAt[index] : now
  );
  return { words, changedAt };
}

/** Length of the longest prefix whose words have all been unchanged for `stableMs`. */
export function stableWordCount(tracker: WordTracker, now: number, stableMs = LIVE_SPEECH_STABLE_MS): number {
  let count = 0;
  while (count < tracker.words.length && now - tracker.changedAt[count] >= stableMs) count += 1;
  return count;
}

/**
 * The next range of words to speak, starting after the `spoken` words already handled, or
 * null to keep waiting. Returns word indexes [start, end).
 */
export function nextLiveSegment(
  tracker: WordTracker,
  spoken: number,
  now: number
): { start: number; end: number } | null {
  const stable = stableWordCount(tracker, now);
  const waiting = stable - spoken;
  if (waiting <= 0) return null;
  if (waiting >= LIVE_SPEECH_MIN_WORDS) {
    return { start: spoken, end: spoken + Math.min(waiting, LIVE_SPEECH_MAX_WORDS) };
  }
  // A short tail that has stayed put for a while: the speaker slowed down, so say it now
  const lastChange = Math.max(...tracker.changedAt.slice(spoken, stable));
  return now - lastChange >= LIVE_SPEECH_LINGER_MS ? { start: spoken, end: stable } : null;
}

/**
 * When an utterance is finalized after part of it was already read live: the words still to
 * speak, and how many already-spoken words belong to the next utterance (Chrome can finalize
 * only the first part of the interim it showed).
 */
export function finalRemainder(finalText: string, spoken: number): { remainder: string; carry: number } {
  const words = splitWords(finalText);
  return {
    remainder: words.slice(spoken).join(' '),
    carry: Math.max(0, spoken - words.length),
  };
}
