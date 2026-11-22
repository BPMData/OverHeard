import { describe, expect, it } from 'vitest';
import { boostQuietWav } from './loudness';

function wavWith(values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + values.length * 2);
  new Int16Array(buffer, 44).set(values);
  return buffer;
}

const rms = (wav: ArrayBuffer) => {
  const s = new Int16Array(wav, 44);
  return Math.sqrt(s.reduce((sum, v) => sum + (v / 32768) ** 2, 0) / s.length);
};

describe('boostQuietWav', () => {
  it('raises a quiet clip without clipping', () => {
    const quiet = wavWith(Array.from({ length: 2000 }, (_, i) => Math.round(Math.sin(i / 5) * 1500)));
    const before = rms(quiet);
    const out = boostQuietWav(quiet);
    expect(rms(out)).toBeGreaterThan(before * 1.5);
    expect(Math.max(...new Int16Array(out, 44).map(Math.abs))).toBeLessThanOrEqual(32767);
  });

  it('leaves a loud clip alone', () => {
    const values = Array.from({ length: 2000 }, (_, i) => Math.round(Math.sin(i / 5) * 20000));
    const loud = wavWith(values);
    boostQuietWav(loud);
    expect(Array.from(new Int16Array(loud, 44))).toEqual(values);
  });

  it('ignores silence and empty clips', () => {
    expect(() => boostQuietWav(wavWith([0, 0, 0]))).not.toThrow();
    expect(() => boostQuietWav(new ArrayBuffer(10))).not.toThrow();
  });
});
