import { describe, expect, it } from 'vitest';
import { createFinalDeduper } from './speechDedupe';

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
