// Chrome's translator first, then Bergamot where Chrome can't, as onDevice.ts wires them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  status: new Map<string, 'unavailable' | 'downloadable' | 'downloading' | 'available'>(),
  runnable: true,
  download: vi.fn(async (_lang: string, onProgress?: (f: number) => void) => { onProgress?.(0.5); }),
  create: vi.fn(async (lang: string) => ({ engine: 'bergamot', translate: async (t: string) => `${lang}(bergamot):${t}`, destroy() {} })),
}));

vi.mock('./translation/bergamot/engine', () => ({
  isBergamotRunnable: () => engine.runnable,
  hasBergamotModel: (lang: string, source = 'en') => engine.runnable && source === 'en' && engine.status.has(lang),
  bergamotAvailability: async (lang: string) => engine.status.get(lang) ?? 'unavailable',
  downloadBergamotModel: (lang: string, onProgress?: (f: number) => void) =>
    engine.download(lang, onProgress).then(() => { engine.status.set(lang, 'available'); }),
  createBergamotTranslator: engine.create,
  isBergamotTranslator: (v: unknown) => (v as { engine?: string })?.engine === 'bergamot',
}));

type Global = Record<string, unknown>;
const g = globalThis as Global;
const load = () => import('./onDevice');

beforeEach(() => {
  engine.status = new Map([['ur', 'available'], ['es', 'downloadable'], ['prs', 'downloadable']]);
  engine.runnable = true;
  engine.download.mockClear();
  engine.create.mockClear();
});
afterEach(() => {
  delete g.Translator;
  vi.resetModules();
});

describe('on-device translation with Bergamot as the fallback', () => {
  it('counts as supported without Chrome, but only Chrome brings on-device speech', async () => {
    const m = await load();
    expect(m.isOnDeviceTranslationSupported()).toBe(true);
    expect(m.hasChromeTranslator()).toBe(false);
  });

  it('uses Chrome when it can, and never touches Bergamot then', async () => {
    g.Translator = { availability: async () => 'available', create: async () => ({ translate: async (t: string) => `chrome:${t}` }) };
    const m = await load();
    await expect(m.translateOnDevice('Hello', 'es')).resolves.toBe('chrome:Hello');
    expect(await m.getOnDeviceAvailability('es')).toBe('available');
    expect(engine.create).not.toHaveBeenCalled();
  });

  it('uses a saved Bergamot model for a language Chrome lacks', async () => {
    g.Translator = { availability: async () => 'unavailable', create: vi.fn() };
    const m = await load();
    expect(await m.getOnDeviceAvailability('ur')).toBe('available');
    await expect(m.translateOnDevice('Hello', 'ur')).resolves.toBe('ur(bergamot):Hello');
    // Chrome's pack list (Settings) must not count Bergamot models as Chrome packs
    expect(await m.getChromeAvailability('ur')).toBe('unavailable');
  });

  it('waits for a click on a button showing the size before downloading a model', async () => {
    const m = await load();
    const progress: Array<[string, number | null]> = [];
    m.prepareOnDeviceTranslators(['es'], (code, fraction) => progress.push([code, fraction]));
    await vi.waitFor(() => expect(progress).toContainEqual(['es', m.PACK_NEEDS_CLICK]));
    expect(engine.download).not.toHaveBeenCalled();
    expect(m.waitingPackSize('es')).toEqual({ size: '35 MB', note: undefined });
    expect(await m.getOnDeviceAvailability('es')).toBe('downloadable');

    m.startWaitingPack('es');
    await vi.waitFor(() => expect(progress).toContainEqual(['es', 1]));
    expect(engine.download).toHaveBeenCalledTimes(1);
    expect(progress).toContainEqual(['es', 0.5]);
    expect(m.waitingPackSize('es')).toBeNull();
    await expect(m.translateOnDevice('Hi', 'es')).resolves.toBe('es(bergamot):Hi');
  });

  it('labels Dari as approximate on its download button', async () => {
    const m = await load();
    m.prepareOnDeviceTranslators(['prs'], () => {});
    await vi.waitFor(() => expect(m.waitingPackSize('prs')).not.toBeNull());
    expect(m.waitingPackSize('prs')).toEqual({ size: '21 MB', note: 'approximate: Iranian Persian, not Afghan Dari' });
  });

  it('never downloads unasked: without a progress callback a missing model is just unavailable', async () => {
    const m = await load();
    await expect(m.translateOnDevice('Hi', 'es')).rejects.toBeInstanceOf(m.OnDeviceUnavailableError);
    expect(engine.download).not.toHaveBeenCalled();
  });

  it('still fails for languages with neither Chrome nor a Bergamot model', async () => {
    const m = await load();
    expect(await m.getOnDeviceAvailability('ht')).toBe('unavailable');
    await expect(m.translateOnDevice('Hi', 'ht')).rejects.toBeInstanceOf(m.OnDeviceUnavailableError);
  });

  it('falls back to Bergamot when Chrome errors for a language Bergamot has', async () => {
    g.Translator = { availability: async () => { throw new Error('service crashed'); }, create: vi.fn() };
    const m = await load();
    await expect(m.translateOnDevice('Hello', 'ur')).resolves.toBe('ur(bergamot):Hello');
  });

  it('uses Bergamot when Chrome never answers, and stops asking Chrome for a while', async () => {
    vi.useFakeTimers();
    const availability = vi.fn(() => new Promise<string>(() => {}));
    g.Translator = { availability, create: vi.fn() };
    const m = await load();
    const status = m.getOnDeviceAvailability('ur');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(status).resolves.toBe('available');
    const translated = m.translateOnDevice('Hello', 'ur');
    await vi.advanceTimersByTimeAsync(0);
    await expect(translated).resolves.toBe('ur(bergamot):Hello');
    expect(availability).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("doesn't let Bergamot downloads hold back the offline speech pack", async () => {
    const speech = { available: vi.fn(async () => 'downloadable'), install: vi.fn(async () => true) };
    g.SpeechRecognition = speech;
    g.Translator = { availability: async () => 'unavailable', create: vi.fn() };
    const m = await load();
    m.prepareOfflineSpeechIfTranslatorsReady([{ code: 'es', source: 'en' }], [{ key: 'speech', locale: 'en-US' }]);
    await vi.waitFor(() => expect(speech.install).toHaveBeenCalled());
    delete g.SpeechRecognition;
  });
});
