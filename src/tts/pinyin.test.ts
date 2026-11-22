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

import { numbersToChinese } from './pinyin';

describe('numbersToChinese', () => {
  it('reads numbers as Chinese words', () => {
    expect(numbersToChinese('第42页')).toBe('第四十二页');
    expect(numbersToChinese('10')).toBe('十');
    expect(numbersToChinese('2025年')).toBe('二千零二十五年');
    expect(numbersToChinese('105')).toBe('一百零五');
    expect(numbersToChinese('3.5')).toBe('三点五');
    expect(numbersToChinese('50%')).toBe('百分之五十');
    expect(numbersToChinese('20000')).toBe('二万');
  });
});

import { splitChineseForSpeech } from './pinyin';

describe('splitChineseForSpeech', () => {
  it('splits on sentence ends and keeps the punctuation', () => {
    expect(splitChineseForSpeech('你好。今天好吗？很好！')).toEqual(['你好。', '今天好吗？', '很好！']);
  });
  it('breaks a long sentence at commas', () => {
    const long = '这是一个很长的句子，'.repeat(8) + '结束。';
    expect(splitChineseForSpeech(long, 30).every((piece) => piece.length <= 40)).toBe(true);
  });
});
