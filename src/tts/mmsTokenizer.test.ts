import { describe, expect, it } from 'vitest';
import fixtures from './__fixtures__/mms-tokenizer-fixtures.json';
import { mmsInputIds, splitForMms } from './mmsTokenizer';
import { MMS_VOCABS } from './mmsVocab';

describe('mmsInputIds', () => {
  // Expected ids come from Transformers' VitsTokenizer (facebook/mms-tts-<iso3>, v4.46.3).
  for (const [lang, { text, ids }] of Object.entries(fixtures as Record<string, { text: string; ids: number[] }>)) {
    it(`matches the Python tokenizer for ${lang}`, () => {
      expect(mmsInputIds(text, MMS_VOCABS[lang])).toEqual(ids);
    });
  }

  it('puts the blank between and around characters and drops unknown ones', () => {
    expect(mmsInputIds(' Ab?c ', { a: 1, b: 2, c: 3 })).toEqual([0, 1, 0, 2, 0, 3, 0]);
  });

  it('returns only the blank for text the voice cannot say', () => {
    expect(mmsInputIds('!!!', MMS_VOCABS.swh)).toEqual([0]);
  });
});

describe('splitForMms', () => {
  it('splits sentences and long runs of words', () => {
    expect(splitForMms('Habari. Leo ni siku nzuri!  Karibu?')).toEqual(['Habari.', 'Leo ni siku nzuri!', 'Karibu?']);
    const long = Array.from({ length: 80 }, () => 'neno').join(' ');
    const pieces = splitForMms(long, 50);
    expect(pieces.every((piece) => piece.length <= 50)).toBe(true);
    expect(pieces.join(' ')).toBe(long);
  });
});
