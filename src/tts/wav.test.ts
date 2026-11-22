import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a 16-bit mono WAV with a silent gap between clips', async () => {
    const blob = encodeWav([Float32Array.from([1, -1]), Float32Array.from([0.5])], 16000, 0.001);
    const view = new DataView(await blob.arrayBuffer());
    const gap = 16; // 16 kHz × 1 ms
    expect(view.byteLength).toBe(44 + (3 + gap) * 2);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe((3 + gap) * 2);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(44 + (2 + gap) * 2, true)).toBe(Math.round(0.5 * 32767 - 0.5));
  });
});
