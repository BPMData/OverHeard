export const wordCount = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/** Words per frozen live-translation chunk. The open tail holds CHUNK..2*CHUNK-1 words. */
export const LIVE_CHUNK_WORDS = 12;

/**
 * Split a growing interim transcript into word-aligned chunks for simultaneous translation.
 *
 * Earlier chunks keep the same word boundaries as the speaker continues, so each one is
 * translated once and reused; only the open tail is retranslated. The tail is never shorter
 * than `chunkWords` (unless the whole text is), so the translator always has some context,
 * and no request grows with the length of an unbroken run-on sentence.
 */
export function liveChunks(text: string, chunkWords = LIVE_CHUNK_WORDS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const frozen = Math.max(0, Math.floor(words.length / chunkWords) - 1);
  const chunks: string[] = [];
  for (let i = 0; i < frozen; i += 1) {
    chunks.push(words.slice(i * chunkWords, (i + 1) * chunkWords).join(' '));
  }
  chunks.push(words.slice(frozen * chunkWords).join(' '));
  return chunks;
}

/**
 * True when `current` still reads as the same speech that `source` was translated from:
 * the speaker kept talking, or the recognizer revised the last few words. A wholesale
 * rewrite of the hypothesis returns false, so its old translation is not shown beside it.
 */
export function continuesSpeech(source: string, current: string): boolean {
  const before = source.toLowerCase().split(/\s+/).filter(Boolean);
  const after = current.toLowerCase().split(/\s+/).filter(Boolean);
  let shared = 0;
  while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared += 1;
  return shared > 0 && shared * 2 >= before.length;
}
