import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from './__fixtures__/fakeCaches';
import { bergamotModelFor, modelFileUrl, type BergamotModel } from './models';
import { OpusWorkers } from './opus';
import { downloadAndSaveModel, isModelSaved, removeSavedModel, savedModelSizes } from './store';
import type { WorkerLike } from './worker';

type Message = { id: number; type: string; lang?: string; text?: string };

class FakeOpusWorker implements WorkerLike {
  listeners: Record<string, Array<(event: never) => void>> = { message: [], error: [] };
  calls: Message[] = [];
  terminated = false;
  constructor(public respond: (message: Message) => unknown) {}
  postMessage(message: Message) {
    this.calls.push(message);
    queueMicrotask(() => {
      if (this.terminated) return;
      let reply: object;
      try {
        reply = { id: message.id, result: this.respond(message) };
      } catch (error) {
        reply = { id: message.id, error: { message: (error as Error).message } };
      }
      for (const listener of this.listeners.message) listener({ data: reply } as never);
    });
  }
  addEventListener(type: 'message' | 'error', listener: (event: never) => void) { this.listeners[type].push(listener); }
  terminate() { this.terminated = true; }
  fail(message: string) { for (const listener of this.listeners.error) listener({ message } as never); }
}

function setup(respond: (message: Message) => unknown = (m) => (m.type === 'translate' ? `sw:${m.text}` : true)) {
  const workers: FakeOpusWorker[] = [];
  const opus = new OpusWorkers(() => {
    const worker = new FakeOpusWorker(respond);
    workers.push(worker);
    return worker;
  });
  return { opus, workers };
}

describe('Opus-MT workers', () => {
  it('loads the language once, then translates in that worker', async () => {
    const { opus, workers } = setup();
    await Promise.all([opus.load('sw'), opus.load('sw')]);
    expect(await opus.translate('sw', 'Hello')).toBe('sw:Hello');
    expect(workers).toHaveLength(1);
    expect(workers[0].calls.map((c) => c.type)).toEqual(['load', 'translate']);
    expect(workers[0].calls[0].lang).toBe('sw');
  });

  it('frees the model by ending its worker, and starts a new one next time', async () => {
    const { opus, workers } = setup();
    await opus.load('sw');
    opus.unload('sw');
    expect(workers[0].terminated).toBe(true);
    expect(opus.isLoaded('sw')).toBe(false);
    expect(await opus.translate('sw', 'Again')).toBe('sw:Again');
    expect(workers).toHaveLength(2);
  });

  it('fails waiting work when the worker crashes or the model can’t load', async () => {
    const { opus, workers } = setup();
    await opus.load('sw');
    workers[0].respond = () => new Promise(() => {}) as never; // never answers
    const pending = opus.translate('sw', 'Hi');
    await Promise.resolve();
    workers[0].fail('out of memory');
    await expect(pending).rejects.toThrow('out of memory');

    const broken = setup((m) => { if (m.type === 'load') throw new Error('model missing'); return ''; });
    await expect(broken.opus.load('sw')).rejects.toThrow('model missing');
    expect(broken.opus.isLoaded('sw')).toBe(false);
  });
});

describe('Swahili in the saved-model store', () => {
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const real = bergamotModelFor('sw')!;
  // Same paths and host as the real model, tiny contents
  const bodies = real.files.map((file, i) => new Uint8Array(i + 2).fill(i + 1));
  const model: BergamotModel = {
    ...real,
    files: real.files.map((file, i) => ({ ...file, bytes: bodies[i].length, sha256: sha(bodies[i]) })),
  };
  const byUrl = new Map(model.files.map((file, i) => [modelFileUrl(model, file), bodies[i]]));
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const body = byUrl.get(String(input));
    return body ? new Response(body as unknown as BodyInit) : new Response('no', { status: 404 });
  }) as unknown as typeof fetch;

  it('downloads from the Opus-MT host and saves under those URLs', async () => {
    const storage = new FakeCacheStorage();
    await downloadAndSaveModel(model, () => {}, { storage, fetchImpl });
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe(
      'https://bpmdata.github.io/overheard-translation-models/opus-mt-en-sw/config.json',
    );
    expect(await isModelSaved(model, storage)).toBe(true);
    await removeSavedModel('sw', storage);
    expect(await isModelSaved(model, storage)).toBe(false);
  });

  it('is measured as Swahili in Settings once complete', async () => {
    const storage = new FakeCacheStorage();
    const cache = await storage.open('overheard-bergamot-v1');
    // The real file list with real sizes in the headers
    for (const file of real.files) {
      await cache.put(modelFileUrl(real, file), new Response('x', { headers: { 'content-length': String(file.bytes) } }));
    }
    expect(await savedModelSizes(storage)).toEqual([{ lang: 'sw', bytes: 138422157 }]);
  });
});
