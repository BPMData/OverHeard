import { describe, expect, it, vi } from 'vitest';
import type { SpeechClient } from './piperClient';
import { createVoiceStorageCategory, RUNTIME_CACHE_NAME, savedVoiceLabel } from './voiceStorage';

function fakeCaches(entries: Record<string, number>) {
  const store = new Map(Object.entries(entries));
  const cache = {
    keys: async () => [...store.keys()].map((url) => new Request(url)),
    match: async (request: Request) => {
      const size = store.get(request.url);
      return size === undefined ? undefined : new Response('x', { headers: { 'content-length': String(size) } });
    },
    delete: async (request: Request) => store.delete(request.url),
  };
  return {
    store,
    storage: {
      has: async (name: string) => name === RUNTIME_CACHE_NAME,
      open: async () => cache as unknown as Cache,
    },
  };
}

function client(overrides: Partial<SpeechClient>): SpeechClient {
  return {
    isPiperSupported: () => true,
    shouldUsePiper: () => true,
    preloadVoice: vi.fn(),
    prefetch: vi.fn(),
    speak: vi.fn(),
    subscribeStatus: () => () => undefined,
    unlockAudio: vi.fn(),
    ...overrides,
  };
}

const ORIGIN = 'https://overheard.test';

describe('downloaded voices storage', () => {
  it('names a saved model by language and every voice it holds', () => {
    expect(savedVoiceLabel('es_MX-claude-high')).toBe('Spanish · Claude (Female · MX)');
    expect(savedVoiceLabel('fr_FR-upmc-medium')).toBe('French · Jessica (Female · FR), Pierre (Male · FR)');
    expect(savedVoiceLabel('unknown-model')).toBe('unknown-model');
  });

  it('lists saved voices, unfinished downloads and the shared voice engine with their sizes', async () => {
    const { storage } = fakeCaches({
      [`${ORIGIN}/ort/ort-wasm-simd-threaded.jsep.wasm`]: 21_596_019,
      [`${ORIGIN}/piper/piper_phonemize.data`]: 18_077_249,
      'https://fonts.gstatic.com/font.woff2': 40_000,
    });
    const category = createVoiceStorageCategory(
      client({
        listSavedSizes: async () => [
          { modelId: 'uk_UA-tetiana-high', bytes: 114_208_928 },
          { modelId: 'es_MX-claude-high', bytes: 63_127_272 },
          { modelId: '', bytes: 1_000 },
        ],
      }),
      () => storage,
    );
    const items = await category.list();
    expect(items.map(({ id, bytes }) => [id, bytes])).toEqual([
      ['es_MX-claude-high', 63_127_272],
      ['uk_UA-tetiana-high', 114_208_928],
      ['leftovers', 1_000],
      ['runtime', 21_596_019 + 18_077_249], // fonts aren't counted as voices
    ]);
    expect(items.every((item) => item.removable)).toBe(true);
  });

  it('deletes one voice, the leftovers, the engine, or everything', async () => {
    const { storage, store } = fakeCaches({
      [`${ORIGIN}/ort/ort.wasm`]: 10,
      [`${ORIGIN}/piper/piper.data`]: 10,
      'https://fonts.gstatic.com/font.woff2': 5,
    });
    const removeSavedModel = vi.fn(async () => undefined);
    const removeAllSavedModels = vi.fn(async () => undefined);
    const category = createVoiceStorageCategory(client({ removeSavedModel, removeAllSavedModels }), () => storage);

    await category.removeItem!('es_MX-claude-high');
    expect(removeSavedModel).toHaveBeenLastCalledWith('es_MX-claude-high');
    await category.removeItem!('leftovers');
    expect(removeSavedModel).toHaveBeenLastCalledWith('');

    await category.removeAll!();
    expect(removeAllSavedModels).toHaveBeenCalledTimes(1);
    // The engine goes with the voices; fonts in the same cache stay
    expect([...store.keys()]).toEqual(['https://fonts.gstatic.com/font.woff2']);
  });

  it('lists nothing when voices are unsupported or there is no cache', async () => {
    const category = createVoiceStorageCategory(client({}), () => null);
    expect(await category.list()).toEqual([]);
  });
});
