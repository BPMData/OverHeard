import { describe, expect, it } from 'vitest';
import { shouldSendImmediately, wordCount } from './liveTranslation';

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
