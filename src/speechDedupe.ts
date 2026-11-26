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

export type FinalStep = { drop: number; add: string };

export function createFinalDeduper() {
  let previous: string[] = [];
  let afterHandoff = false;
  /**
   * Call when passing the turn while keeping the same recognizer running. A strictly longer
   * cumulative phrase still has the previous speaker's prefix stripped, while an exact repeat
   * or shorter prefix ("Thank you" -> "Thank you") starts the new speaker's turn instead of
   * being swallowed as a duplicate final.
   */
  const markTurnBoundary = () => {
    afterHandoff = previous.length > 0;
  };
  /**
   * How to apply one final to the text built from earlier finals of this session: remove the
   * last `drop` words, then append `add`. Besides growing copies, the engine sometimes
   * corrects an earlier word in its running copy ("never bugs all you" → "never bugs while
   * you"). A final sharing a long start with the previous one is such a correction, so only
   * the changed tail is replaced instead of the whole paragraph being appended again.
   */
  const revise = (text: string): FinalStep => {
    const words = split(text);
    if (!words.length) return { drop: 0, add: '' };
    if (afterHandoff) {
      afterHandoff = false;
      if (words.length > previous.length && starts(words, previous)) {
        const add = words.slice(previous.length).join(' ');
        previous = words;
        return { drop: 0, add };
      }
      previous = words;
      return { drop: 0, add: words.join(' ') };
    }
    if (starts(words, previous)) {
      const add = words.slice(previous.length).join(' ');
      previous = words;
      return { drop: 0, add };
    }
    if (starts(previous, words)) return { drop: 0, add: '' };
    let common = 0;
    while (common < Math.min(words.length, previous.length) && norm(words[common]) === norm(previous[common])) common++;
    const kept = new Set(words.map(norm));
    const shared = previous.filter((w) => kept.has(norm(w))).length;
    const step =
      common >= 3 && (common * 2 >= previous.length || shared >= previous.length * 0.7)
        ? { drop: previous.length - common, add: words.slice(common).join(' ') }
        : { drop: 0, add: words.join(' ') };
    previous = words;
    return step;
  };
  /** New words only, for output that can't be edited afterwards (captions): a correction to
   *  words already shown is ignored, and only words beyond them are returned. */
  const take = (text: string): string => {
    const { drop, add } = revise(text);
    return drop ? split(add).slice(drop).join(' ') : add;
  };
  /** The same filtering for an interim result, without remembering it. */
  const peek = (text: string): string => {
    const words = split(text);
    if (afterHandoff) {
      if (words.length > previous.length && starts(words, previous)) {
        return words.slice(previous.length).join(' ');
      }
      return words.join(' ');
    }
    if (starts(words, previous)) return words.slice(previous.length).join(' ');
    return starts(previous, words) ? '' : words.join(' ');
  };
  return Object.assign(take, { peek, revise, markTurnBoundary });
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

/** `text` without its last `count` words. */
export function dropLastWords(text: string, count: number): string {
  if (count <= 0) return text;
  return split(text).slice(0, -count).join(' ');
}

/**
 * `text` without the words of `echo` at its start: unfinished words that were already sent
 * with the previous turn and now arrive again as the shared recognizer's final (sometimes
 * slightly revised, "still talkin" → "still talking"). Text that is only part of the echo
 * yields ''. Text that doesn't start with the echo passes through whole.
 */
export function stripEcho(text: string, echo: string): string {
  const words = split(text);
  const sent = split(echo);
  if (!sent.length) return words.join(' ');
  if (starts(sent, words)) return '';
  if (starts(words, sent)) return words.slice(sent.length).join(' ');
  // A revised copy: most of the sent words at the start, the last of them possibly changed
  const head = words.slice(0, sent.length);
  const sentWords = new Set(sent.map(norm));
  const shared = head.filter((w) => sentWords.has(norm(w))).length;
  const needed = Math.min(sent.length - 1, Math.ceil(sent.length * 0.7));
  if (head.length === sent.length && sent.length >= 2 && shared >= needed)
    return words.slice(sent.length).join(' ');
  return words.join(' ');
}
