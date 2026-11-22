import { describe, expect, it } from 'vitest';
import { splitPinyinSyllable, textToPinyinPhonemes } from './pinyin';

describe('pinyin phonemes', () => {
  it('splits syllables into initial, final and tone', () => {
    expect(splitPinyinSyllable('zhong1')).toEqual(['zh', 'ong', '1']);
    expect(splitPinyinSyllable('you3')).toEqual(['y', 'ou', '3']);
    expect(splitPinyinSyllable('xue2')).toEqual(['x', 'ue', '2']);
    expect(splitPinyinSyllable('er2')).toEqual(['Ø', 'er', '2']);
    expect(splitPinyinSyllable('lv4')).toEqual(['l', 'v', '4']);
    expect(splitPinyinSyllable('de0')).toEqual(['d', 'e', '5']);
    expect(splitPinyinSyllable('shi')).toEqual(['sh', 'i', '5']);
  });

  it('keeps punctuation and the written tones', () => {
    expect(textToPinyinPhonemes('你好。')).toEqual(['n', 'i', '3', 'h', 'ao', '3', '。']);
  });
});
