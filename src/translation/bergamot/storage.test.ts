import { describe, expect, it, vi } from 'vitest';
import { RUNTIME_CACHE_NAME } from '../../tts/voiceStorage';
import { FakeCacheStorage } from './__fixtures__/fakeCaches';
import { BERGAMOT_ENGINE_ITEM_ID, bergamotItemLabel, createBergamotStorageCategory } from './storage';
import { BERGAMOT_LEFTOVERS_ID } from './store';

describe('On-device translation models storage category', () => {
  it('lists saved languages with sizes, leftovers, and the shared engine', async () => {
    const cacheStorage = new FakeCacheStorage();
    const runtime = await cacheStorage.open(RUNTIME_CACHE_NAME);
    await runtime.put('https://app.test/bergamot/bergamot-translator-worker.wasm', new Response(new Uint8Array(5) as unknown as BodyInit));
    await runtime.put('https://app.test/ort/ort.wasm', new Response(new Uint8Array(9) as unknown as BodyInit));
    const category = createBergamotStorageCategory({
      sizes: async () => [{ lang: 'ur', bytes: 100 }, { lang: 'prs', bytes: 50 }, { lang: '', bytes: 7 }],
      cacheStorage: () => cacheStorage,
    });
    expect(category.title).toBe('On-device translation models');
    expect(category.description).toContain('MPL-2.0');
    expect(category.afterRemoveNote).toMatch(/download its model again/);
    expect(category.afterRemoveItemNote).toMatch(/download its model again/);
    expect(await category.list()).toEqual([
      { id: 'prs', label: 'English → Dari (approximate: Iranian Persian, not Afghan Dari)', bytes: 50, removable: true },
      { id: 'ur', label: 'English → Urdu', bytes: 100, removable: true },
      { id: BERGAMOT_LEFTOVERS_ID, label: 'Unfinished or old translation downloads', bytes: 7, removable: true },
      { id: BERGAMOT_ENGINE_ITEM_ID, label: 'Translation engine (shared by every language except Swahili)', bytes: 5, removable: true },
    ]);
  });

  it('deletes one language, leftovers, the engine, or everything', async () => {
    const cacheStorage = new FakeCacheStorage();
    const runtime = await cacheStorage.open(RUNTIME_CACHE_NAME);
    await runtime.put('https://app.test/bergamot/translator-worker.js', new Response('x'));
    await runtime.put('https://app.test/piper/piper.wasm', new Response('y'));
    const remove = vi.fn(async () => {});
    const removeAll = vi.fn(async () => {});
    const category = createBergamotStorageCategory({ sizes: async () => [], remove, removeAll, cacheStorage: () => cacheStorage });
    await category.removeItem!('ur');
    await category.removeItem!(BERGAMOT_LEFTOVERS_ID);
    expect(remove.mock.calls).toEqual([['ur'], ['']]);
    await category.removeAll!();
    expect(removeAll).toHaveBeenCalled();
    // Only the translation engine leaves the shared runtime cache; voices keep theirs
    expect((await runtime.keys()).map((r) => r.url)).toEqual(['https://app.test/piper/piper.wasm']);
  });

  it('names languages plainly', () => {
    expect(bergamotItemLabel('es')).toBe('English → Spanish');
  });
});
