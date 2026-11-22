import { pinyin } from 'pinyin-pro';

// Piper's Chinese "pinyin" voices (chaowen, xiao_ya) don't use eSpeak. Each syllable is
// spoken as: initial (or "Ø" when there is none), final, tone digit. For example 中 = zh, ong, 1.
// Finals are what's left of the spelling after the initial, so 有 (you) = y + ou and
// 学 (xue) = x + ue, matching the voices' own symbol lists.
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

const PUNCTUATION: Record<string, string> = {
  '。': '。', '.': '.', '？': '？', '?': '?', '！': '！', '!': '!',
  '，': '，', ',': ',', '、': '、', '：': '：', ':': ':', '；': '；', ';': ';',
  '…': '…', '—': '—', ' ': ' ',
};

export function splitPinyinSyllable(syllable: string): string[] {
  const match = /^([a-zv]+?)([0-5])?$/.exec(syllable);
  if (!match) return [];
  const spelling = match[1];
  const tone = match[2] && match[2] !== '0' ? match[2] : '5';
  const initial = INITIALS.find((candidate) => spelling.startsWith(candidate) && spelling.length > candidate.length);
  const final = initial ? spelling.slice(initial.length) : spelling;
  return [initial ?? 'Ø', final, tone];
}

/** Turns Chinese text into the symbols a Piper pinyin voice was trained on. */
export function textToPinyinPhonemes(text: string): string[] {
  const pieces = pinyin(text, { toneType: 'num', type: 'array', v: true, nonZh: 'consecutive' });
  const phonemes: string[] = [];
  for (const piece of pieces) {
    if (/^[a-zv]+[0-5]?$/.test(piece)) {
      phonemes.push(...splitPinyinSyllable(piece));
      continue;
    }
    for (const char of piece) {
      const mark = PUNCTUATION[char];
      if (mark) phonemes.push(mark);
    }
  }
  return phonemes;
}

// Piper pads after each syllable's tone and after punctuation, not after every symbol
// (see phonemes_to_ids in piper1-gpl's phonemize_chinese.py).
const GROUP_END = new Set(['1', '2', '3', '4', '5', '。', '.', '？', '?', '！', '!', '—', '…', '、', '，', ',', '：', ':', '；', ';', ' ']);

/** Piper's id layout for pinyin voices: start marker, symbols, a pad after each group, end marker. */
export function pinyinPhonemeIds(text: string, idMap: Record<string, number[]>): number[] {
  const pad = idMap['_'] ?? [0];
  const ids: number[] = [...(idMap['^'] ?? [1])];
  for (const symbol of textToPinyinPhonemes(text)) {
    const id = idMap[symbol];
    if (!id) continue;
    ids.push(...id);
    if (GROUP_END.has(symbol)) ids.push(...pad);
  }
  ids.push(...(idMap['$'] ?? [2]));
  return ids;
}
