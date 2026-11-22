import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from './__fixtures__/fakeCaches';
import { BERGAMOT_MODELS, type BergamotModel } from './models';
import {
  BERGAMOT_CACHE_NAME, downloadAndSaveModel, downloadFile, fileUrl, isModelSaved, readSavedModel,
  removeSavedModel, savedModelSizes,
} from './store';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (n: number, fill: number) => new Uint8Array(n).fill(fill);

/** A tiny two-file model whose files are served by `fetchFor`. */
function tinyModel(lang = 'es'): { model: BergamotModel; bodies: Map<string, Uint8Array> } {
  const model = bytesOf(10, 1);
  const lex = bytesOf(4, 2);
  const vocab = bytesOf(3, 3);
  const real = BERGAMOT_MODELS.find((m) => m.lang === lang)!;
  const files = [
    { part: 'model' as const, path: real.files.find((f) => f.part === 'model')!.path, bytes: 10, sha256: sha(model) },
    { part: 'lex' as const, path: real.files.find((f) => f.part === 'lex')!.path, bytes: 4, sha256: sha(lex) },
    { part: 'vocab' as const, path: real.files.find((f) => f.part === 'vocab')!.path, bytes: 3, sha256: sha(vocab) },
  ];
  const bodies = new Map([
    [fileUrl(files[0].path), model],
    [fileUrl(files[1].path), lex],
    [fileUrl(files[2].path), vocab],
  ]);
  return { model: { lang, pair: real.pair, files }, bodies };
}

const fetchFor = (bodies: Map<string, Uint8Array>, override?: (url: string) => Response | undefined) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const replaced = override?.(url);
    if (replaced) return replaced;
    const body = bodies.get(url);
    // GitHub Pages sends a gzip Content-Length that doesn't match the body; it must be ignored
    return body ? new Response(body as unknown as BodyInit, { headers: { 'Content-Length': '5' } }) : new Response('no', { status: 404 });
  }) as unknown as typeof fetch;

describe('downloadFile', () => {
  it('checks the known size and hash, not Content-Length', async () => {
    const body = bytesOf(8, 7);
    const fetchImpl = fetchFor(new Map([['u', body]]));
    const seen: number[] = [];
    await expect(downloadFile('u', { bytes: 8, sha256: sha(body) }, (n) => seen.push(n), fetchImpl)).resolves.toEqual(body);
    expect(seen.at(-1)).toBe(8);
  });

  it('rejects a short, long or damaged download', async () => {
    const body = bytesOf(8, 7);
    const fetchImpl = fetchFor(new Map([['u', body]]));
    await expect(downloadFile('u', { bytes: 9, sha256: sha(body) }, () => {}, fetchImpl)).rejects.toThrow('interrupted');
    await expect(downloadFile('u', { bytes: 7, sha256: sha(body) }, () => {}, fetchImpl)).rejects.toThrow('wrong size');
    await expect(downloadFile('u', { bytes: 8, sha256: '0'.repeat(64) }, () => {}, fetchImpl)).rejects.toThrow('damaged');
    await expect(downloadFile('missing', { bytes: 8, sha256: '' }, () => {}, fetchImpl)).rejects.toThrow('HTTP 404');
  });
});

describe('saved models', () => {
  it('saves every file together and reads them back', async () => {
    const storage = new FakeCacheStorage();
    const { model, bodies } = tinyModel();
    const progress: number[] = [];
    await downloadAndSaveModel(model, (f) => progress.push(f), { storage, fetchImpl: fetchFor(bodies) });
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.max(...progress)).toBeLessThan(1);
    expect(await isModelSaved(model, storage)).toBe(true);
    const buffers = await readSavedModel(model, storage);
    expect(new Uint8Array(buffers!.model!)).toEqual(bytesOf(10, 1));
    expect(new Uint8Array(buffers!.vocab!)).toEqual(bytesOf(3, 3));
  });

  it('saves nothing when one file fails', async () => {
    const storage = new FakeCacheStorage();
    const { model, bodies } = tinyModel();
    const lexUrl = fileUrl(model.files[1].path);
    const fetchImpl = fetchFor(bodies, (url) => (url === lexUrl ? new Response(bytesOf(2, 0) as unknown as BodyInit) : undefined));
    await expect(downloadAndSaveModel(model, () => {}, { storage, fetchImpl })).rejects.toThrow();
    expect(await isModelSaved(model, storage)).toBe(false);
    const cache = await storage.open(BERGAMOT_CACHE_NAME);
    expect(await cache.keys()).toHaveLength(0);
  });

  it('lists sizes per language, counts stray files as leftovers, and deletes them', async () => {
    const storage = new FakeCacheStorage();
    const es = tinyModel('es');
    await downloadAndSaveModel(es.model, () => {}, { storage, fetchImpl: fetchFor(es.bodies) });
    const cache = await storage.open(BERGAMOT_CACHE_NAME);
    // The real catalog's Spanish files are 3 of 3 present (paths match), so Spanish is complete
    await cache.put(fileUrl('v0/old/model.bin'), new Response(bytesOf(6, 9) as unknown as BodyInit));
    expect(await savedModelSizes(storage)).toEqual([
      { lang: 'es', bytes: 17 },
      { lang: '', bytes: 6 },
    ]);
    await removeSavedModel('', storage);
    expect(await savedModelSizes(storage)).toEqual([{ lang: 'es', bytes: 17 }]);
    await removeSavedModel('es', storage);
    expect(await savedModelSizes(storage)).toEqual([]);
  });

  it('reports nothing saved when the cache was never made', async () => {
    const storage = new FakeCacheStorage();
    expect(await savedModelSizes(storage)).toEqual([]);
    expect(await isModelSaved(BERGAMOT_MODELS[0], storage)).toBe(false);
    expect(storage.caches.size).toBe(0);
  });
});
