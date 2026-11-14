import { describe, expect, it } from 'vitest';
import { appendDistinct, createFinalDeduper, dropLastWords, mergeInterim } from './speechDedupe';

describe('createFinalDeduper', () => {
  it('collapses cumulative Android finals into new words only', () => {
    const next = createFinalDeduper();
    const out = ['why', 'why', 'why is', 'why is it', 'Why is it doubling?', 'why is it doubling anything']
      .map(next)
      .filter(Boolean)
      .join(' ');
    expect(out).toBe('why is it doubling? anything');
  });

  it('passes ordinary incremental finals through', () => {
    const next = createFinalDeduper();
    expect([next('hello there'), next('how are you')]).toEqual(['hello there', 'how are you']);
  });
});

describe('appendDistinct', () => {
  it('drops a repeated multi-word overlap but keeps a single repeated word', () => {
    expect(appendDistinct('why is it doubling', 'it doubling anything')).toBe('why is it doubling anything');
    expect(appendDistinct('I said no', 'no way')).toBe('I said no no way');
    expect(appendDistinct('', 'hello')).toBe('hello');
  });
});

describe('mergeInterim', () => {
  it('collapses growing copies but joins desktop pieces', () => {
    expect(mergeInterim(['why', 'why is', 'why is it'])).toBe('why is it');
    expect(mergeInterim(['hello', 'how are'])).toBe('hello how are');
    expect(mergeInterim(['why is it', 'why'])).toBe('why is it');
  });
});

describe('corrections to an earlier word', () => {
  const long = 'it never boils away watching it and never bugs all you have the bee bug mode';
  const fixed = 'it never boils away watching it and never bugs while you have the bee bug mode on';
  it('replaces only the changed tail in an editable draft', () => {
    const next = createFinalDeduper();
    let draft = next.revise(long).add;
    const { drop, add } = next.revise(fixed);
    draft = appendDistinct(dropLastWords(draft, drop), add);
    expect(draft).toBe(fixed);
  });
  it('adds only words beyond those already shown for captions', () => {
    const next = createFinalDeduper();
    next(long);
    expect(next(fixed)).toBe('on');
  });
  it('still treats a different sentence as new', () => {
    const next = createFinalDeduper();
    next('hello there my friend');
    expect(next('how are you')).toBe('how are you');
  });
});
