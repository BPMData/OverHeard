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

describe('on-device speech', () => {
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
