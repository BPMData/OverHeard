/**
 * Some Android speech engines (seen on budget tablets) send cumulative final results in
 * continuous mode: "why", "why is", "why is it", … each as a new final. Appending every final
 * then repeats the sentence over and over.
 *
 * Returns a function for one recognition session that turns each final into only its new
 * words: a final that extends the previous one yields the extension, a repeat of (part of)
 * the previous one yields '', anything else passes through whole.
 */
const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const split = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const starts = (long: string[], short: string[]) =>
  short.length > 0 && short.length <= long.length && short.every((w, i) => norm(w) === norm(long[i]));

export function createFinalDeduper() {
  let previous: string[] = [];
  const take = (text: string): string => {
    const words = split(text);
    if (!words.length) return '';
    if (starts(words, previous)) {
      const delta = words.slice(previous.length);
      previous = words;
      return delta.join(' ');
    }
    if (starts(previous, words)) return '';
    previous = words;
    return words.join(' ');
  };
  /** The same filtering for an interim result, without remembering it. */
  const peek = (text: string): string => {
    const words = split(text);
    if (starts(words, previous)) return words.slice(previous.length).join(' ');
    return starts(previous, words) ? '' : words.join(' ');
  };
  return Object.assign(take, { peek });
}

/**
 * Join `text` onto `draft`, dropping any words at the start of `text` that repeat the end of
 * `draft` (two or more words, so a deliberately repeated single word survives). Catches
 * cumulative results that carry over a recognizer restart.
 */
export function appendDistinct(draft: string, text: string): string {
  const a = split(draft);
  const b = split(text);
  for (let k = Math.min(a.length, b.length); k >= 2; k--) {
    if (starts(b, a.slice(a.length - k))) return [...a, ...b.slice(k)].join(' ');
  }
  return [...a, ...b].join(' ');
}

/**
 * Join the unfinished results of one recognition event. Desktop Chrome splits a phrase into
 * separate pieces ("hello" + "how are"), which are joined. Some Android engines instead keep
 * several growing copies ("why", "why is", "why is it"), so a piece that extends the text so
 * far replaces it and a piece already contained at its start is skipped.
 */
export function mergeInterim(parts: string[]): string {
  let words: string[] = [];
  for (const part of parts) {
    const next = split(part);
    if (!next.length) continue;
    if (starts(next, words) || !words.length) words = next;
    else if (!starts(words, next)) words = [...words, ...next];
  }
  return words.join(' ');
}
