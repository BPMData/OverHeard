// Talks to the Bergamot WebAssembly worker that ships in @browsermt/bergamot-translator
// (copied to /bergamot/ at build time, see vite.config.ts). It runs single-threaded, so the
// app needs no cross-origin isolation headers. One worker holds up to MAX_LOADED models.
import type { BergamotPart } from './models';

export const BERGAMOT_WORKER_URL = '/bergamot/translator-worker.js';
const MAX_LOADED = 3;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent & ErrorEvent) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

const defaultFactory: WorkerFactory = () => new Worker(BERGAMOT_WORKER_URL) as unknown as WorkerLike;

export class BergamotWorker {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private serial = 0;
  private pending = new Map<number, Pending>();
  /** Loaded pairs, least recently used first */
  private loaded: string[] = [];
  private loading = new Map<string, Promise<void>>();
  private readonly factory: WorkerFactory;

  constructor(factory: WorkerFactory = defaultFactory) {
    this.factory = factory;
  }

  private call(name: string, args: unknown[], transfer: Transferable[] = []): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Translation worker stopped'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, name, args }, transfer);
    });
  }

  /** Stops the worker and fails everything waiting on it; the next call starts a new one. */
  reset(reason = 'Translation worker stopped'): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.loaded = [];
    this.loading.clear();
    const error = new Error(reason);
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = this.factory();
    this.worker = worker;
    worker.addEventListener('message', ({ data }) => {
      const { id, result, error } = (data ?? {}) as { id?: number; result?: unknown; error?: { message?: string } };
      const waiting = id === undefined ? undefined : this.pending.get(id);
      if (!waiting) return;
      this.pending.delete(id!);
      if (error !== undefined) waiting.reject(new Error(error?.message || 'Translation failed'));
      else waiting.resolve(result);
    });
    worker.addEventListener('error', (event) => {
      if (this.worker === worker) this.reset(event?.message || 'Translation worker failed to start');
    });
    const ready = this.call('initialize', [{ cacheSize: 0, useNativeIntGemm: false }]).then(() => undefined);
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.reset();
    });
    return ready;
  }

  isLoaded(pair: string): boolean {
    return this.loaded.includes(pair);
  }

  /** Loads a model from its saved files. `buffers` are transferred to the worker. */
  load(pair: string, buffers: Partial<Record<BergamotPart, ArrayBuffer>>): Promise<void> {
    if (this.isLoaded(pair)) return Promise.resolve();
    const running = this.loading.get(pair);
    if (running) return running;
    const promise = (async () => {
      await this.start();
      const vocabs = buffers.vocab ? [buffers.vocab] : [buffers.srcvocab, buffers.trgvocab];
      if (!buffers.model || !buffers.lex || vocabs.some((v) => !v)) throw new Error(`Incomplete model ${pair}`);
      const transfer = [buffers.model, buffers.lex, ...(vocabs as ArrayBuffer[])];
      const key = { from: pair.slice(0, 2), to: pair.slice(2) };
      await this.call(
        'loadTranslationModel',
        [key, { model: buffers.model, shortlist: buffers.lex, vocabs, config: {} }],
        transfer
      );
      this.loaded.push(pair);
      while (this.loaded.length > MAX_LOADED) {
        const oldest = this.loaded.shift()!;
        void this.call('freeTranslationModel', [{ from: oldest.slice(0, 2), to: oldest.slice(2) }]).catch(() => {});
      }
    })();
    this.loading.set(pair, promise);
    const done = () => {
      if (this.loading.get(pair) === promise) this.loading.delete(pair);
    };
    promise.then(done, done);
    return promise;
  }

  /** Forget a model (after its files were deleted, for example). */
  unload(pair: string): void {
    if (!this.isLoaded(pair)) return;
    this.loaded = this.loaded.filter((p) => p !== pair);
    void this.call('freeTranslationModel', [{ from: pair.slice(0, 2), to: pair.slice(2) }]).catch(() => {});
  }

  async translate(pair: string, text: string): Promise<string> {
    if (!this.isLoaded(pair)) throw new Error(`Model ${pair} isn't loaded`);
    // Mark it recently used
    this.loaded = [...this.loaded.filter((p) => p !== pair), pair];
    const responses = (await this.call('translate', [
      { models: [{ from: pair.slice(0, 2), to: pair.slice(2) }], texts: [{ text, html: false, qualityScores: false }] },
    ])) as Array<{ target?: { text?: string } }>;
    return responses?.[0]?.target?.text ?? '';
  }
}
