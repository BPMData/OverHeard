// Joins float audio clips (-1..1) into one mono 16-bit PCM WAV, with a short pause between them.

export function encodeWav(clips: readonly Float32Array[], sampleRate: number, gapSeconds = 0.15): Blob {
  const gap = Math.round(sampleRate * gapSeconds);
  const total = clips.reduce((sum, clip) => sum + clip.length, 0) + gap * Math.max(0, clips.length - 1);
  const wav = new DataView(new ArrayBuffer(44 + total * 2));
  const writeText = (offset: number, value: string) => {
    for (let n = 0; n < value.length; n += 1) wav.setUint8(offset + n, value.charCodeAt(n));
  };
  writeText(0, 'RIFF');
  wav.setUint32(4, 36 + total * 2, true);
  writeText(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  writeText(36, 'data');
  wav.setUint32(40, total * 2, true);
  let at = 44;
  clips.forEach((clip, index) => {
    if (index > 0) at += gap * 2; // The buffer starts zeroed, so skipping writes silence
    for (let n = 0; n < clip.length; n += 1) {
      const v = Math.max(-1, Math.min(1, clip[n]));
      wav.setInt16(at, v < 0 ? v * 32768 : v * 32767, true);
      at += 2;
    }
  });
  return new Blob([wav], { type: 'audio/x-wav' });
}
