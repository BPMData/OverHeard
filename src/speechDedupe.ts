/**
 * Some Android speech engines (seen on budget tablets) send cumulative final results in
 * continuous mode: "why", "why is", "why is it", … each as a new final. Appending every final
 * then repeats the sentence over and over.
 *
 * Returns a function for one recognition session that turns each final into only its new
 * words: a final that extends the previous one yields the extension, a repeat of (part of)
 * the previous one yields '', anything else passes through whole.
 */
export function createFinalDeduper() {
  let previous: string[] = [];
  const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  return (text: string): string => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    const starts = (long: string[], short: string[]) =>
      short.length > 0 && short.length <= long.length && short.every((w, i) => norm(w) === norm(long[i]));
    if (starts(words, previous)) {
      const delta = words.slice(previous.length);
      previous = words;
      return delta.join(' ');
    }
    if (starts(previous, words)) return '';
    previous = words;
    return words.join(' ');
  };
}
