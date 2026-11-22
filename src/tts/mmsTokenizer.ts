// Text → input ids for Meta MMS voices (facebook/mms-tts-<iso3>). MMS is VITS with a character
// vocabulary: no phonemizer and, for the languages OverHeard uses, no uroman romanizer. This is
// a port of Transformers' VitsTokenizer with normalize=true, add_blank=true, phonemize=false.

export type MmsVocab = Readonly<Record<string, number>>;

/** Lower-case what isn't in the vocabulary as written (VitsTokenizer.normalize_text). */
function normalize(text: string, tokens: readonly string[]): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const match = tokens.find((token) => token && text.startsWith(token, i));
    if (match) {
      out += match;
      i += match.length;
    } else {
      out += text[i].toLowerCase();
      i += 1;
    }
  }
  return out;
}

/**
 * Character ids with the blank (id 0) between and around them, as the model was trained.
 * Characters the voice doesn't know (digits, most punctuation) are dropped.
 */
export function mmsInputIds(text: string, vocab: MmsVocab): number[] {
  // Longest tokens first, so a multi-character token wins over its first character.
  const tokens = Object.keys(vocab).sort((a, b) => b.length - a.length);
  const normalized = normalize(text, tokens);
  // Python iterates code points; Array.from does too (keeps surrogate pairs together).
  const chars = Array.from(normalized).filter((char) => Object.prototype.hasOwnProperty.call(vocab, char));
  // .strip() in Python: drop leading/trailing whitespace characters that survived the filter.
  while (chars.length && /\s/.test(chars[0])) chars.shift();
  while (chars.length && /\s/.test(chars[chars.length - 1])) chars.pop();
  const ids: number[] = [0];
  for (const char of chars) ids.push(vocab[char], 0);
  return ids;
}

/**
 * Splits text into sentence-sized pieces, so one long caption doesn't make one huge inference
 * (VITS memory grows with length) and each piece gets a natural pause.
 */
export function splitForMms(text: string, maxChars = 220): string[] {
  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;:…])\s+|\n+/)) {
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const cut = Math.max(rest.lastIndexOf(', ', maxChars), rest.lastIndexOf(' ', maxChars));
      const at = cut > maxChars / 3 ? cut : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  return pieces;
}
