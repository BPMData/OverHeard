import { describe, expect, it } from 'vitest';
import { intFromEnv } from './config';

describe('intFromEnv', () => {
  it('reads whole numbers, including zero', () => {
    expect(intFromEnv('250', 10)).toBe(250);
    expect(intFromEnv(' 7 ', 10)).toBe(7);
    expect(intFromEnv('0', 10)).toBe(0);
  });

  it('falls back when unset, blank, negative, fractional or not a number', () => {
    for (const raw of [undefined, '', '   ', '-5', '2.5', 'lots', 'NaN']) {
      expect(intFromEnv(raw, 10)).toBe(10);
    }
  });
});
