// Some voices are much quieter than others (Meta's Haitian Creole voice is about 13 dB under
// Swahili). This raises quiet 16-bit PCM WAV clips toward a common loudness and never
// attenuates, so loud voices stay as they are.
const TARGET_RMS = 0.1; // about -20 dBFS
const MAX_GAIN = 6; // about +15 dB, so noise isn't boosted without limit
const PEAK_LIMIT = 0.95;
const HEADER_BYTES = 44;

export function boostQuietWav(wav: ArrayBuffer): ArrayBuffer {
  if (wav.byteLength <= HEADER_BYTES) return wav;
  const samples = new Int16Array(wav, HEADER_BYTES, Math.floor((wav.byteLength - HEADER_BYTES) / 2));
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  if (samples.length === 0 || peak === 0) return wav;
  const rms = Math.sqrt(sumSquares / samples.length);
  const gain = Math.min(TARGET_RMS / rms, PEAK_LIMIT / peak, MAX_GAIN);
  if (gain <= 1.05) return wav;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain)));
  }
  return wav;
}
