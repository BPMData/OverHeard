// Bergamot on-device translation: whether a language can run here, its shared download, and
// translator instances for src/onDevice.ts, which tries Chrome's built-in translator first.
// Nothing here sends caption text anywhere; only model files are downloaded.
import { notifyStorageChanged } from '../../storage/registry';
import { bergamotModelFor } from './models';
import {
  downloadAndSaveModel, isModelSaved, readSavedModel, removeAllSavedModels, removeSavedModel,
} from './store';
import { BergamotWorker } from './worker';

export type BergamotAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface BergamotTranslator {
  engine: 'bergamot';
  translate(text: string): Promise<string>;
  destroy(): void;
}

/** A model that isn't saved is checked again after this long (another tab may have saved it). */
const NOT_SAVED_RECHECK_MS = 30_000;

let worker = new BergamotWorker();
const saved = new Map<string, boolean | number>(); // true, or the time "not saved" was checked
const downloads = new Map<string, Promise<void>>();

/** Can this browser run Bergamot at all (Worker + WebAssembly + Cache Storage + SubtleCrypto)? */
export function isBergamotRunnable(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof caches !== 'undefined' &&
    typeof globalThis.crypto?.subtle?.digest === 'function'
  );
}

export const hasBergamotModel = (lang: string, source = 'en'): boolean =>
  isBergamotRunnable() && bergamotModelFor(lang, source) !== null;

export async function bergamotAvailability(lang: string, source = 'en'): Promise<BergamotAvailability> {
  const model = bergamotModelFor(lang, source);
  if (!model || !isBergamotRunnable()) return 'unavailable';
  if (downloads.has(lang)) return 'downloading';
  const known = saved.get(lang);
  if (known === true) return 'available';
  if (typeof known === 'number' && Date.now() - known < NOT_SAVED_RECHECK_MS) return 'downloadable';
  const isSaved = await isModelSaved(model).catch(() => false);
  saved.set(lang, isSaved || Date.now());
  return isSaved ? 'available' : 'downloadable';
}

/**
 * Download and save a language's model. Calls for the same language share one download.
 * `onProgress` gets 0–1 by bytes.
 */
export function downloadBergamotModel(lang: string, onProgress?: (fraction: number) => void): Promise<void> {
  const model = bergamotModelFor(lang);
  if (!model) return Promise.reject(new Error(`No on-device model for ${lang}`));
  const listeners = progressListeners.get(lang) ?? new Set<(fraction: number) => void>();
  progressListeners.set(lang, listeners);
  if (onProgress) listeners.add(onProgress);
  const running = downloads.get(lang);
  if (running) return running;
  const promise = downloadAndSaveModel(model, (fraction) => {
    for (const listener of listeners) listener(fraction);
  }).then(() => {
    saved.set(lang, true);
    notifyStorageChanged();
  });
  downloads.set(lang, promise);
  const done = () => {
    downloads.delete(lang);
    progressListeners.delete(lang);
  };
  promise.then(done, done);
  return promise;
}
const progressListeners = new Map<string, Set<(fraction: number) => void>>();

/** A translator for a saved model. Rejects when the model isn't saved (or can't load). */
export async function createBergamotTranslator(lang: string, source = 'en'): Promise<BergamotTranslator> {
  const model = bergamotModelFor(lang, source);
  if (!model) throw new Error(`No on-device model for ${lang}`);
  const load = async () => {
    if (worker.isLoaded(model.pair)) return;
    const buffers = await readSavedModel(model);
    if (!buffers) {
      saved.delete(lang);
      throw new Error(`The ${lang} translation model isn't downloaded`);
    }
    await worker.load(model.pair, buffers);
  };
  await load();
  const started = performance.now();
  // Warm up: the first sentence after loading is slower, so don't spend it on a caption.
  await worker.translate(model.pair, 'Hello.').catch(() => '');
  console.info(`[bergamot] ${model.pair} ready in ${Math.round(performance.now() - started)} ms`);
  return {
    engine: 'bergamot',
    translate: async (text: string) => {
      // Another language may have pushed this model out of the worker; load it again.
      await load();
      return worker.translate(model.pair, text);
    },
    destroy: () => {},
  };
}

export const isBergamotTranslator = (value: unknown): value is BergamotTranslator =>
  typeof value === 'object' && value !== null && (value as { engine?: unknown }).engine === 'bergamot';

/** Delete a saved model (Settings → Space used on this device). '' deletes leftover files. */
export async function deleteBergamotModel(lang: string): Promise<void> {
  await removeSavedModel(lang);
  if (lang) {
    saved.delete(lang);
    const model = bergamotModelFor(lang);
    if (model) worker.unload(model.pair);
  }
}

export async function deleteAllBergamotModels(): Promise<void> {
  await removeAllSavedModels();
  saved.clear();
  worker.reset('Translation models deleted');
  worker = new BergamotWorker();
}

/** For tests */
export function resetBergamotForTests(next: BergamotWorker = new BergamotWorker()): void {
  worker.reset();
  worker = next;
  saved.clear();
  downloads.clear();
  progressListeners.clear();
}
