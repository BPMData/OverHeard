import { describe, expect, it } from 'vitest';
import { continuesSpeech, liveChunks, shouldSendImmediately, wordCount } from './liveTranslation';

describe('wordCount', () => {
  it('counts words and ignores extra whitespace', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('  open   your books ')).toBe(3);
  });
});

describe('shouldSendImmediately', () => {
  it('waits for a pause until enough new words have piled up', () => {
    expect(shouldSendImmediately('one two three', '', 6)).toBe(false);
    expect(shouldSendImmediately('one two three four five six', '', 6)).toBe(true);
  });

  it('counts only words added since the last send', () => {
    const lastSent = 'one two three four five six';
    expect(shouldSendImmediately(`${lastSent} seven eight`, lastSent, 6)).toBe(false);
    expect(
      shouldSendImmediately(`${lastSent} seven eight nine ten eleven twelve`, lastSent, 6)
    ).toBe(true);
  });
});

describe('liveChunks', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  it('keeps short utterances as one chunk', () => {
    expect(liveChunks('', 3)).toEqual([]);
    expect(liveChunks(words(5), 3)).toEqual([words(5)]);
  });

  it('freezes leading chunks at stable word boundaries as speech continues', () => {
    const at24 = liveChunks(words(24), 12);
    const at35 = liveChunks(words(35), 12);
    expect(at24).toHaveLength(2);
    expect(at35[0]).toBe(at24[0]);
    expect(wordCount(at35[1])).toBe(23);
    expect(liveChunks(words(36), 12).map(wordCount)).toEqual([12, 12, 12]);
  });

  it('bounds every chunk for an arbitrarily long run-on sentence', () => {
    const chunks = liveChunks(words(500), 12);
    expect(Math.max(...chunks.map(wordCount))).toBeLessThan(24);
    expect(chunks.join(' ')).toBe(words(500));
  });
});

describe('continuesSpeech', () => {
  it('accepts growth and small revisions but not rewrites', () => {
    expect(continuesSpeech('hello class', 'hello class today we')).toBe(true);
    expect(continuesSpeech('open your box', 'open your books')).toBe(true);
    expect(continuesSpeech('The old sentence has six words', 'A new sentence')).toBe(false);
  });
});
