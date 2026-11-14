import { afterEach, describe, expect, it, vi } from 'vitest';

type Global = Record<string, unknown>;
const g = globalThis as Global;

afterEach(() => {
  delete g.Translator;
  delete g.SpeechRecognition;
  vi.resetModules();
});

// Fresh module per test so its translator cache starts empty
const load = () => import('./onDevice');

describe('on-device translation', () => {
  it('reports unsupported when the browser has no Translator API', async () => {
    const m = await load();
    expect(m.isOnDeviceTranslationSupported()).toBe(false);
    await expect(m.translateOnDevice('Hello', 'es')).rejects.toBeInstanceOf(
      m.OnDeviceUnavailableError
    );
  });

  it('translates with the built-in translator and reuses it', async () => {
    const create = vi.fn(async () => ({ translate: async (t: string) => `es:${t}` }));
    g.Translator = { availability: async () => 'available', create };
    const m = await load();
    await expect(m.translateOnDevice('Hello', 'es')).resolves.toBe('es:Hello');
    await m.translateOnDevice('Bye', 'es');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps Dari to fa-AF and rejects languages the device lacks', async () => {
    const availability = vi.fn(async () => 'unavailable');
    g.Translator = { availability, create: vi.fn() };
    const m = await load();
    await expect(m.translateOnDevice('Hello', 'prs')).rejects.toBeInstanceOf(
      m.OnDeviceUnavailableError
    );
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'fa-AF' });
  });

  it('retries creation after a failed download instead of caching the failure', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValue({ translate: async () => 'Hola' });
    g.Translator = { availability: async () => 'downloadable', create };
    const m = await load();
    await expect(m.translateOnDevice('Hello', 'es')).rejects.toThrow('NotAllowedError');
    await expect(m.translateOnDevice('Hello', 'es')).resolves.toBe('Hola');
  });
});

describe('download progress', () => {
  it('reads fractions, byte counts, and clamps', async () => {
    const m = await load();
    expect(m.progressFraction({ loaded: 0.42 })).toBe(0.42);
    expect(m.progressFraction({ loaded: 50, total: 200 })).toBe(0.25);
    expect(m.progressFraction({ loaded: 1.5 })).toBe(1);
  });

  it('reports 0, download events, then 1 when the pack is ready', async () => {
    g.Translator = {
      availability: async () => 'downloadable',
      create: async (opts: { monitor?: (m: EventTarget) => void }) => {
        const target = new EventTarget();
        opts.monitor?.(target);
        const event = Object.assign(new Event('downloadprogress'), { loaded: 0.5 });
        target.dispatchEvent(event);
        return { translate: async () => 'Hola' };
      },
    };
    const m = await load();
    const onProgress = vi.fn();
    m.prepareOnDeviceTranslators(['es'], onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith('es', 1));
    expect(onProgress.mock.calls.map((c) => c[1])).toEqual([0, 0.5, 1]);
  });

  it('reports null for a language the device cannot translate', async () => {
    g.Translator = { availability: async () => 'unavailable', create: vi.fn() };
    const m = await load();
    const onProgress = vi.fn();
    m.prepareOnDeviceTranslators(['so'], onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith('so', null));
  });

  it('skips progress entirely when the pack is already installed', async () => {
    g.Translator = {
      availability: async () => 'available',
      create: async () => ({ translate: async () => 'Hola' }),
    };
    const m = await load();
    const onProgress = vi.fn();
    m.prepareOnDeviceTranslators(['es'], onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
    expect(onProgress.mock.calls).toEqual([['es', 1]]);
  });
});

describe('on-device speech', () => {
  it('signals a download start only when the pack needs installing', async () => {
    const onStart = vi.fn();
    g.SpeechRecognition = { available: async () => 'available', install: vi.fn() };
    let m = await load();
    await m.prepareOnDeviceSpeech('en-US', onStart);
    expect(onStart).not.toHaveBeenCalled();

    vi.resetModules();
    g.SpeechRecognition = { available: async () => 'downloadable', install: async () => true };
    m = await load();
    await m.prepareOnDeviceSpeech('en-US', onStart);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('is false without the speech API', async () => {
    const m = await load();
    await expect(m.prepareOnDeviceSpeech()).resolves.toBe(false);
  });

  it('installs the language pack when it is downloadable', async () => {
    const install = vi.fn(async () => true);
    g.SpeechRecognition = { available: async () => 'downloadable', install };
    const m = await load();
    await expect(m.prepareOnDeviceSpeech('en-US')).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
  });

  it('is false when the device cannot run it, or when the check throws', async () => {
    g.SpeechRecognition = { available: async () => 'unavailable', install: vi.fn() };
    let m = await load();
    await expect(m.prepareOnDeviceSpeech()).resolves.toBe(false);

    vi.resetModules();
    g.SpeechRecognition = {
      available: async () => {
        throw new Error('blocked');
      },
      install: vi.fn(),
    };
    m = await load();
    await expect(m.prepareOnDeviceSpeech()).resolves.toBe(false);
  });

  it('supports the older availableOnDevice/installOnDevice names', async () => {
    const installOnDevice = vi.fn(async () => true);
    g.SpeechRecognition = { availableOnDevice: async () => 'downloadable', installOnDevice };
    const m = await load();
    await expect(m.prepareOnDeviceSpeech('en-US')).resolves.toBe(true);
    expect(installOnDevice).toHaveBeenCalledWith('en-US');
  });
});

describe('bidirectional on-device translation', () => {
  it('caches by pair and maps the source for availability and creation', async () => {
    const availability = vi.fn(async () => 'available');
    const create = vi.fn(async () => ({ translate: async (text: string) => text }));
    g.Translator = { availability, create };
    const m = await load();
    await m.translateOnDevice('same', 'en', 'es');
    await m.translateOnDevice('same', 'es', 'en');
    await m.translateOnDevice('same', 'en', 'es');
    await m.translateOnDevice('same', 'en', 'prs');
    expect(create).toHaveBeenCalledTimes(3);
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'es', targetLanguage: 'en' });
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'fa-AF', targetLanguage: 'en' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'es', targetLanguage: 'en' }));
  });
});

describe('conversation preparation', () => {
  it('starts every download at once: both translation directions and both speech packs', async () => {
    const availability = vi.fn(async () => 'downloadable');
    g.Translator = { availability, create: () => new Promise(() => {}) };
    const install = vi.fn(() => new Promise<boolean>(() => {}));
    g.SpeechRecognition = { available: async () => 'downloadable', install };
    const m = await load();
    m.prepareOnDeviceConversation({ a: 'en', b: 'es' });
    // Neither install has finished, yet both have started: none waits for another
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    expect(install).toHaveBeenCalledWith({ langs: ['es-US'], processLocally: true });
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'es', targetLanguage: 'en' });
  });

  it('skips translation and downloads one speech pack when both sides share a language', async () => {
    const availability = vi.fn(async () => 'downloadable');
    g.Translator = { availability, create: vi.fn() };
    const install = vi.fn(async () => true);
    g.SpeechRecognition = { available: async () => 'downloadable', install };
    const m = await load();
    m.prepareOnDeviceConversation({ a: 'en', b: 'en' });
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(availability).not.toHaveBeenCalled();
  });

  it('reports speech packs as speech:<code> and clears them when done', async () => {
    g.SpeechRecognition = { available: async () => 'downloadable', install: async () => true };
    const m = await load();
    const onProgress = vi.fn();
    m.prepareOnDeviceConversation({ a: 'en', b: 'en' }, onProgress);
    await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith('speech:en', null));
    expect(onProgress.mock.calls).toEqual([
      ['speech:en', -1],
      ['speech:en', null],
    ]);
  });
});

describe('sharing speech preparation', () => {
  it('shares an install that is already running instead of starting a second one', async () => {
    let finish!: (ok: boolean) => void;
    const install = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    g.SpeechRecognition = { available: async () => 'downloadable', install };
    const m = await load();
    const first = m.prepareOnDeviceSpeech('es-US');
    const second = m.prepareOnDeviceSpeech('es-US');
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    finish(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('checks again once an attempt has finished instead of remembering its result', async () => {
    const available = vi
      .fn()
      .mockResolvedValueOnce('unavailable')
      .mockResolvedValueOnce('available');
    g.SpeechRecognition = { available, install: vi.fn() };
    const m = await load();
    await expect(m.prepareOnDeviceSpeech('es-US')).resolves.toBe(false);
    await expect(m.prepareOnDeviceSpeech('es-US')).resolves.toBe(true);
  });
});
