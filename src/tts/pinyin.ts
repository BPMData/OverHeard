import { pinyin } from 'pinyin-pro';

// Piper's Chinese "pinyin" voices (chaowen, xiao_ya) don't use eSpeak. Each syllable is
// spoken as: initial (or "Ø" when there is none), final, tone digit. For example 中 = zh, ong, 1.
// Finals are what's left of the spelling after the initial, so 有 (you) = y + ou and
// 学 (xue) = x + ue, matching the voices' own symbol lists.
// The symbol ids of xiao_ya and chaowen, copied from their model configs (they are identical).
export const PINYIN_PHONEME_ID_MAP: Record<string, number[]> = {
  _: [0],
  '^': [1],
  $: [2],
  Ø: [3],
  b: [4],
  p: [5],
  m: [6],
  f: [7],
  d: [8],
  t: [9],
  n: [10],
  l: [11],
  g: [12],
  k: [13],
  h: [14],
  j: [15],
  q: [16],
  x: [17],
  zh: [18],
  ch: [19],
  sh: [20],
  r: [21],
  z: [22],
  c: [23],
  s: [24],
  y: [25],
  w: [26],
  a: [27],
  o: [28],
  e: [29],
  ai: [30],
  ei: [31],
  ao: [32],
  ou: [33],
  an: [34],
  en: [35],
  ang: [36],
  eng: [37],
  ong: [38],
  i: [39],
  ia: [40],
  ie: [41],
  iao: [42],
  iu: [43],
  ian: [44],
  in: [45],
  iang: [46],
  ing: [47],
  iong: [48],
  u: [49],
  ua: [50],
  uo: [51],
  uai: [52],
  ui: [53],
  uan: [54],
  un: [55],
  uang: [56],
  ueng: [57],
  v: [58],
  ve: [59],
  van: [60],
  vn: [61],
  er: [62],
  ue: [63],
  '1': [64],
  '2': [65],
  '3': [66],
  '4': [67],
  '5': [68],
  '。': [69],
  '.': [69],
  '？': [70],
  '?': [70],
  '！': [71],
  '!': [71],
  '—': [72],
  '…': [72],
  '、': [72],
  '，': [72],
  ',': [72],
  '：': [72],
  ':': [72],
  '；': [72],
  ';': [72],
  ' ': [72],
};

const INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
];

const PUNCTUATION: Record<string, string> = {
  '。': '。',
  '.': '.',
  '？': '？',
  '?': '?',
  '！': '！',
  '!': '!',
  '，': '，',
  ',': ',',
  '、': '、',
  '：': '：',
  ':': ':',
  '；': '；',
  ';': ';',
  '…': '…',
  '—': '—',
  ' ': ' ',
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
  const pieces = pinyin(numbersToChinese(text), { toneType: 'num', type: 'array', v: true, nonZh: 'consecutive' });
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
const GROUP_END = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  '。',
  '.',
  '？',
  '?',
  '！',
  '!',
  '—',
  '…',
  '、',
  '，',
  ',',
  '：',
  ':',
  '；',
  ';',
  ' ',
]);

/** Piper's id layout for pinyin voices: start marker, symbols, a pad after each group, end marker. */
export function pinyinPhonemeIds(text: string, idMap: Record<string, number[]> = PINYIN_PHONEME_ID_MAP): number[] {
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

/** Chinese words for the digits in captions, so "42" is read as 四十二. */
export function numbersToChinese(text: string): string {
  const digits = '零一二三四五六七八九';
  const smallUnits = ['', '十', '百', '千'];
  const below10000 = (n: number): string => {
    let out = '';
    let needZero = false;
    for (let place = 3; place >= 0; place -= 1) {
      const digit = Math.floor(n / 10 ** place) % 10;
      if (digit === 0) {
        needZero = out !== '';
        continue;
      }
      if (needZero) out += '零';
      needZero = false;
      out += (digit === 1 && place === 1 && out === '' ? '' : digits[digit]) + smallUnits[place];
    }
    return out;
  };
  const integer = (n: number): string => {
    if (n === 0) return '零';
    if (n >= 1e12)
      return String(n)
        .split('')
        .map((d) => digits[Number(d)])
        .join('');
    const parts: string[] = [];
    const yi = Math.floor(n / 1e8);
    const wan = Math.floor((n % 1e8) / 1e4);
    const rest = n % 1e4;
    if (yi) parts.push(`${below10000(yi)}亿`);
    if (wan) parts.push(`${below10000(wan)}万`);
    else if (yi && rest) parts.push('零');
    if (rest) parts.push((wan && rest < 1000 ? '零' : '') + below10000(rest));
    return parts.join('');
  };
  return text.replace(/(\d+)(?:\.(\d+))?(%?)/g, (_m, whole: string, fraction: string | undefined, percent: string) => {
    let words = integer(Number(whole));
    if (fraction)
      words += `点${fraction
        .split('')
        .map((d) => digits[Number(d)])
        .join('')}`;
    return percent ? `百分之${words}` : words;
  });
}

/**
 * Splits Chinese text into pieces a voice can speak in one go: sentences first, then commas
 * when a sentence is long.
 */
export function splitChineseForSpeech(text: string, maxChars = 60): string[] {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]*/g) ?? [];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars) {
      pieces.push(trimmed);
      continue;
    }
    let current = '';
    for (const part of trimmed.match(/[^，、,；;：:]+[，、,；;：:]*/g) ?? [trimmed]) {
      if (current && current.length + part.length > maxChars) {
        pieces.push(current);
        current = '';
      }
      current += part;
    }
    if (current) pieces.push(current);
  }
  return pieces;
}
