import { describe, expect, it } from 'vitest';
import { formatElapsed, packLabel } from './packProgress';

describe('packLabel', () => {
  it('names speech packs and translation packs', () => {
    expect(packLabel('speech')).toBe('English speech');
    expect(packLabel('speech:en')).toBe('English speech');
    expect(packLabel('speech:es')).toBe('Spanish speech');
    expect(packLabel('es')).toBe('Spanish translation');
    expect(packLabel('en')).toBe('English translation');
  });

  it('falls back to the raw code for languages it does not know', () => {
    expect(packLabel('xx')).toBe('xx translation');
    expect(packLabel('speech:xx')).toBe('xx speech');
  });
});

describe('formatElapsed', () => {
  it('formats minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(600_000)).toBe('10:00');
  });
});
