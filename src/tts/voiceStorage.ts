// "Downloaded voices" in Settings → Space used on this device: the Piper voice models saved in
// OPFS by the voice worker, plus the shared voice runtime the service worker keeps.
import { LANGUAGE_MAP } from '../constants';
import type { LanguageCode } from '../types';
import type { StorageCategory, StoredItem } from '../storage/registry';
import type { SpeechClient } from './piperClient';
import { PIPER_VOICES, type PiperLanguage } from './voices';

/** Cache the service worker keeps the voice runtime in (see public/sw.js). */
export const RUNTIME_CACHE_NAME = 'overheard-runtime-v1';
export const RUNTIME_ITEM_ID = 'runtime';
export const LEFTOVERS_ITEM_ID = 'leftovers';
const isRuntimePath = (pathname: string) => pathname.startsWith('/ort/') || pathname.startsWith('/piper/');

function languageName(lang: PiperLanguage): string {
  if (lang === 'en') return 'English';
  return LANGUAGE_MAP[lang as LanguageCode]?.name ?? lang;
}

/** "Spanish · Claude (Female · MX)". One model can hold several voices; they're all named. */
export function savedVoiceLabel(modelId: string): string {
  const voices = PIPER_VOICES.filter((voice) => voice.modelId === modelId);
  if (voices.length === 0) return modelId;
  return `${languageName(voices[0].lang)} · ${voices.map((voice) => voice.label).join(', ')}`;
}

type CacheLike = Pick<CacheStorage, 'open' | 'has'>;

const getCaches = (): CacheLike | null =>
  typeof caches === 'undefined' ? null : (caches as CacheLike);

/** Bytes of the voice runtime files the service worker saved, or 0 when none are saved. */
export async function measureRuntime(cacheStorage: CacheLike | null = getCaches()): Promise<number> {
  if (!cacheStorage || !(await cacheStorage.has(RUNTIME_CACHE_NAME).catch(() => false))) return 0;
  const cache = await cacheStorage.open(RUNTIME_CACHE_NAME);
  let bytes = 0;
  for (const request of await cache.keys()) {
    if (!isRuntimePath(new URL(request.url).pathname)) continue;
    const response = await cache.match(request);
    if (!response) continue;
    const length = Number(response.headers.get('content-length'));
    bytes += Number.isFinite(length) && length > 0 ? length : (await response.blob()).size;
  }
  return bytes;
}

/** Delete the voice runtime files (fonts in the same cache stay). */
export async function removeRuntime(cacheStorage: CacheLike | null = getCaches()): Promise<void> {
  if (!cacheStorage || !(await cacheStorage.has(RUNTIME_CACHE_NAME).catch(() => false))) return;
  const cache = await cacheStorage.open(RUNTIME_CACHE_NAME);
  for (const request of await cache.keys()) {
    if (isRuntimePath(new URL(request.url).pathname)) await cache.delete(request);
  }
}

export function createVoiceStorageCategory(
  client: SpeechClient,
  cacheStorage: () => CacheLike | null = getCaches,
): StorageCategory {
  return {
    id: 'piper-voices',
    title: 'Downloaded voices',
    description:
      'Reader voices saved on this device so read-aloud starts fast and works offline. ' +
      'A deleted voice downloads again the next time it reads aloud (you need to be online).',
    removeAllLabel: 'delete all downloaded voices',
    afterRemoveNote:
      'Read-aloud will need to download each voice again (about 60–120 MB each) before it can speak, ' +
      'and won’t work offline until you save the voices again.',
    afterRemoveItemNote:
      'Read-aloud will need to download it again before this voice can speak, ' +
      'and it won’t work offline until you save it again.',
    list: async () => {
      const items: StoredItem[] = [];
      const sizes = await (client.listSavedSizes?.() ?? Promise.resolve([])).catch(() => []);
      for (const { modelId, bytes } of sizes) {
        items.push(
          modelId
            ? { id: modelId, label: savedVoiceLabel(modelId), bytes, removable: true }
            : { id: LEFTOVERS_ITEM_ID, label: 'Unfinished voice downloads', bytes, removable: true },
        );
      }
      items.sort((a, b) => a.label.localeCompare(b.label));
      const runtimeBytes = await measureRuntime(cacheStorage()).catch(() => 0);
      if (runtimeBytes > 0) {
        items.push({
          id: RUNTIME_ITEM_ID,
          label: 'Voice engine (shared by every voice)',
          bytes: runtimeBytes,
          removable: true,
        });
      }
      return items;
    },
    removeItem: async (id) => {
      if (id === RUNTIME_ITEM_ID) return removeRuntime(cacheStorage());
      await client.removeSavedModel?.(id === LEFTOVERS_ITEM_ID ? '' : id);
    },
    removeAll: async () => {
      await client.removeAllSavedModels?.();
      await removeRuntime(cacheStorage());
    },
  };
}
