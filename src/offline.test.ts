import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechLocality, wantsLocalSpeech } from './offline';

afterEach(() => vi.unstubAllGlobals());

describe('speechLocality', () => {
  it('maps each translator choice to where speech runs', () => {
    expect(speechLocality('on-device')).toBe(true);
    expect(speechLocality('auto')).toBe('when-offline');
    expect(speechLocality('gtx')).toBe(false);
  });
});

describe('wantsLocalSpeech', () => {
  it('uses the device for Auto only while offline', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(wantsLocalSpeech('when-offline')).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    expect(wantsLocalSpeech('when-offline')).toBe(true);
    expect(wantsLocalSpeech(false)).toBe(false);
    expect(wantsLocalSpeech(true)).toBe(true);
  });
});
