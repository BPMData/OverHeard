// "On-device translation models" in Settings → Space used on this device: the Bergamot models
// saved in Cache Storage, plus the translation engine (WebAssembly) the service worker keeps.
import { LANGUAGE_MAP } from '../../constants';
import { formatBytes, type StorageCategory, type StoredItem } from '../../storage/registry';
import type { LanguageCode } from '../../types';
import { RUNTIME_CACHE_NAME } from '../../tts/voiceStorage';
import { deleteAllBergamotModels, deleteBergamotModel } from './engine';
import { BERGAMOT_APPROXIMATE, BERGAMOT_ATTRIBUTION, modelBytes, ON_DEVICE_MODELS, OPUS_ATTRIBUTION } from './models';
import { BERGAMOT_LEFTOVERS_ID, savedModelSizes } from './store';

export const BERGAMOT_ENGINE_ITEM_ID = 'engine';
const isEnginePath = (pathname: string) => pathname.startsWith('/bergamot/');

type CacheLike = Pick<CacheStorage, 'open' | 'has'>;
const getCaches = (): CacheLike | null => (typeof caches === 'undefined' ? null : (caches as CacheLike));

/** "English → Urdu", with a note for a model that only approximates the language. */
export function bergamotItemLabel(lang: string): string {
  const name = LANGUAGE_MAP[lang as LanguageCode]?.name ?? lang;
  const note = BERGAMOT_APPROXIMATE[lang];
  return `English → ${name}${note ? ` (${note})` : ''}`;
}

/** Bytes of the translation engine files the service worker saved. */
export async function measureEngine(cacheStorage: CacheLike | null = getCaches()): Promise<number> {
  if (!cacheStorage || !(await cacheStorage.has(RUNTIME_CACHE_NAME).catch(() => false))) return 0;
  const cache = await cacheStorage.open(RUNTIME_CACHE_NAME);
  let bytes = 0;
  for (const request of await cache.keys()) {
    if (!isEnginePath(new URL(request.url).pathname)) continue;
    const response = await cache.match(request);
    if (!response) continue;
    const length = Number(response.headers.get('content-length'));
    bytes += Number.isFinite(length) && length > 0 ? length : (await response.blob()).size;
  }
  return bytes;
}

export async function removeEngine(cacheStorage: CacheLike | null = getCaches()): Promise<void> {
  if (!cacheStorage || !(await cacheStorage.has(RUNTIME_CACHE_NAME).catch(() => false))) return;
  const cache = await cacheStorage.open(RUNTIME_CACHE_NAME);
  for (const request of await cache.keys()) {
    if (isEnginePath(new URL(request.url).pathname)) await cache.delete(request);
  }
}

export function createBergamotStorageCategory(
  deps: {
    sizes?: typeof savedModelSizes;
    remove?: (lang: string) => Promise<void>;
    removeAll?: () => Promise<void>;
    cacheStorage?: () => CacheLike | null;
  } = {},
): StorageCategory {
  const sizes = deps.sizes ?? (() => savedModelSizes());
  const remove = deps.remove ?? deleteBergamotModel;
  const removeAllModels = deps.removeAll ?? deleteAllBergamotModels;
  const cacheStorage = deps.cacheStorage ?? getCaches;
  const modelSizes = ON_DEVICE_MODELS.map(modelBytes);
  const typical = `${formatBytes(Math.min(...modelSizes)).replace(' MB', '')}–${formatBytes(Math.max(...modelSizes))}`;
  return {
    id: 'bergamot-models',
    title: 'On-device translation models',
    description:
      'Translation models saved on this device so captions can translate here, without sending ' +
      'the text online, where Chrome’s built-in translator can’t (Safari, Firefox, some ' +
      `Chromebooks, and languages like Urdu and Swahili). ${BERGAMOT_ATTRIBUTION.text}; ${OPUS_ATTRIBUTION.text}.`,
    removeAllLabel: 'delete all on-device translation models',
    afterRemoveNote:
      `Each language will need to download its model again (${typical} each) before it can translate on ` +
      'this device. Until then captions use online translation, or stay untranslated with “On this device”.',
    afterRemoveItemNote:
      'This language will need to download its model again before it can translate on this device. ' +
      'Until then its captions use online translation, or stay untranslated with “On this device”.',
    list: async () => {
      const saved = await sizes().catch(() => []);
      const items: StoredItem[] = saved.map(({ lang, bytes }) =>
        lang
          ? { id: lang, label: bergamotItemLabel(lang), bytes, removable: true }
          : { id: BERGAMOT_LEFTOVERS_ID, label: 'Unfinished or old translation downloads', bytes, removable: true },
      );
      items.sort((a, b) => a.label.localeCompare(b.label));
      const engineBytes = await measureEngine(cacheStorage()).catch(() => 0);
      if (engineBytes > 0) {
        items.push({ id: BERGAMOT_ENGINE_ITEM_ID, label: 'Translation engine (shared by every language except Swahili)', bytes: engineBytes, removable: true });
      }
      return items;
    },
    removeItem: async (id) => {
      if (id === BERGAMOT_ENGINE_ITEM_ID) return removeEngine(cacheStorage());
      await remove(id === BERGAMOT_LEFTOVERS_ID ? '' : id);
    },
    removeAll: async () => {
      await removeAllModels();
      await removeEngine(cacheStorage());
    },
  };
}
