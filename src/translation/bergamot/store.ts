// Saved on-device translation models (Bergamot, and Opus-MT for Swahili): one Cache Storage cache, keyed by each file's URL. Cache Storage works in
// every browser this fallback is for (Safari, Firefox, Chrome), unlike OPFS writes from a page.
// The service worker keeps this cache across deploys (see public/sw.js).
import {
  BERGAMOT_BASE_URL,
  modelBytes,
  modelFileUrl,
  ON_DEVICE_MODELS,
  type BergamotModel,
  type BergamotPart,
} from './models';

export const BERGAMOT_CACHE_NAME = 'overheard-bergamot-v1';
/** Item id for files in the cache that belong to no model the app offers now */
export const BERGAMOT_LEFTOVERS_ID = 'leftovers';

type CacheLike = Pick<Cache, 'match' | 'put' | 'delete' | 'keys'>;
export type CachesLike = Pick<CacheStorage, 'open' | 'has' | 'delete'>;

const getCaches = (): CachesLike | null => (typeof caches === 'undefined' ? null : caches);

/** URL of a Bergamot file by path (Opus-MT files: use modelFileUrl) */
export const fileUrl = (path: string) => `${BERGAMOT_BASE_URL}/${path}`;

async function openCache(storage: CachesLike | null, create: boolean): Promise<CacheLike | null> {
  if (!storage) return null;
  if (!create && !(await storage.has(BERGAMOT_CACHE_NAME).catch(() => false))) return null;
  return storage.open(BERGAMOT_CACHE_NAME);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads one file and checks it against the known size and hash. The size comes from the
 * catalog, not Content-Length: GitHub Pages gzips the file, so that header is the compressed size.
 */
export async function downloadFile(
  url: string,
  expected: { bytes: number; sha256: string },
  onBytes: (received: number) => void,
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array> {
  const response = await fetchImpl(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Translation download failed (HTTP ${response.status})`);
  let bytes: Uint8Array;
  if (!response.body) {
    bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length);
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (received > expected.bytes) {
        void reader.cancel().catch(() => {});
        throw new Error('Translation download was the wrong size');
      }
      onBytes(received);
    }
    bytes = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
  }
  if (bytes.length !== expected.bytes) throw new Error('Translation download was interrupted');
  if ((await sha256Hex(bytes)) !== expected.sha256) throw new Error('Translation download was damaged');
  return bytes;
}

/**
 * Downloads every file of a model, then saves them together, so a half-finished download never
 * looks saved. `onProgress` gets 0–1 by bytes.
 */
export async function downloadAndSaveModel(
  model: BergamotModel,
  onProgress: (fraction: number) => void,
  { storage = getCaches(), fetchImpl = fetch }: { storage?: CachesLike | null; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const cache = await openCache(storage, true);
  if (!cache) throw new Error('This browser can’t save translation models');
  const total = modelBytes(model);
  let done = 0;
  const files: Array<{ url: string; bytes: Uint8Array }> = [];
  for (const file of model.files) {
    const url = modelFileUrl(model, file);
    const bytes = await downloadFile(
      url,
      file,
      (received) => onProgress(Math.min(0.99, (done + received) / total)),
      fetchImpl
    );
    done += file.bytes;
    files.push({ url, bytes });
  }
  for (const { url, bytes } of files) {
    await cache.put(
      url,
      new Response(bytes as unknown as BodyInit, {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) },
      })
    );
  }
}

/** True when every file of the model is saved. */
export async function isModelSaved(model: BergamotModel, storage: CachesLike | null = getCaches()): Promise<boolean> {
  const cache = await openCache(storage, false).catch(() => null);
  if (!cache) return false;
  for (const file of model.files) {
    if (!(await cache.match(modelFileUrl(model, file)))) return false;
  }
  return true;
}

/** The saved files, ready for the worker. Null when any file is missing. */
export async function readSavedModel(
  model: BergamotModel,
  storage: CachesLike | null = getCaches()
): Promise<Partial<Record<BergamotPart, ArrayBuffer>> | null> {
  const cache = await openCache(storage, false);
  if (!cache) return null;
  const buffers: Partial<Record<BergamotPart, ArrayBuffer>> = {};
  for (const file of model.files) {
    const response = await cache.match(modelFileUrl(model, file));
    if (!response) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== file.bytes) return null;
    buffers[file.part] = buffer;
  }
  return buffers;
}

const sizeOf = async (response: Response | undefined): Promise<number> => {
  if (!response) return 0;
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : (await response.blob()).size;
};

/** Bytes per saved model (by language), plus '' for files that belong to no current model. */
export async function savedModelSizes(
  storage: CachesLike | null = getCaches()
): Promise<Array<{ lang: string; bytes: number }>> {
  const cache = await openCache(storage, false);
  if (!cache) return [];
  const owner = new Map<string, string>();
  for (const model of ON_DEVICE_MODELS)
    for (const file of model.files) owner.set(modelFileUrl(model, file), model.lang);
  const sizes = new Map<string, number>();
  const present = new Map<string, number>();
  for (const request of await cache.keys()) {
    const lang = owner.get(request.url) ?? '';
    sizes.set(lang, (sizes.get(lang) ?? 0) + (await sizeOf(await cache.match(request))));
    if (lang) present.set(lang, (present.get(lang) ?? 0) + 1);
  }
  const result: Array<{ lang: string; bytes: number }> = [];
  let leftovers = sizes.get('') ?? 0;
  for (const model of ON_DEVICE_MODELS) {
    const bytes = sizes.get(model.lang);
    if (bytes === undefined) continue;
    // Only some files of a model (an older, interrupted save): count them as leftovers
    if (present.get(model.lang) === model.files.length) result.push({ lang: model.lang, bytes });
    else leftovers += bytes;
  }
  if (leftovers > 0) result.push({ lang: '', bytes: leftovers });
  return result;
}

/** Delete one language's model, or with '' every file that isn't part of a complete model. */
export async function removeSavedModel(lang: string, storage: CachesLike | null = getCaches()): Promise<void> {
  const cache = await openCache(storage, false);
  if (!cache) return;
  if (lang) {
    const model = ON_DEVICE_MODELS.find((m) => m.lang === lang);
    for (const file of model?.files ?? []) await cache.delete(modelFileUrl(model!, file));
    return;
  }
  const complete = new Set((await savedModelSizes(storage)).map((size) => size.lang).filter(Boolean));
  const keep = new Set<string>();
  for (const model of ON_DEVICE_MODELS) {
    if (complete.has(model.lang)) for (const file of model.files) keep.add(modelFileUrl(model, file));
  }
  for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
}

export async function removeAllSavedModels(storage: CachesLike | null = getCaches()): Promise<void> {
  await storage?.delete(BERGAMOT_CACHE_NAME);
}
