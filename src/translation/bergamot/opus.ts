// Main-thread side of the Opus-MT worker (opusWorker.ts): one worker per language, since the
// model is the worker's whole memory and ending the worker is how it's freed.
import type { WorkerLike } from './worker';

export type OpusWorkerFactory = () => WorkerLike;

const defaultFactory: OpusWorkerFactory = () =>
  new Worker(new URL('./opusWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

interface Running {
  worker: WorkerLike;
  ready: Promise<void>;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

export class OpusWorkers {
  private running = new Map<string, Running>();
  private serial = 0;
  private readonly factory: OpusWorkerFactory;

  constructor(factory: OpusWorkerFactory = defaultFactory) {
    this.factory = factory;
  }

  private call(entry: Running, message: Record<string, unknown>): Promise<unknown> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject });
      entry.worker.postMessage({ ...message, id });
    });
  }

  private stop(lang: string, entry: Running, reason: string) {
    if (this.running.get(lang) === entry) this.running.delete(lang);
    entry.worker.terminate();
    const error = new Error(reason);
    for (const { reject } of entry.pending.values()) reject(error);
    entry.pending.clear();
  }

  /** Starts the worker for `lang` and loads its saved model. Shared by concurrent callers. */
  load(lang: string): Promise<void> {
    const existing = this.running.get(lang);
    if (existing) return existing.ready;
    const worker = this.factory();
    const entry: Running = { worker, ready: Promise.resolve(), pending: new Map() };
    worker.addEventListener('message', ({ data }) => {
      const { id, result, error } = (data ?? {}) as { id?: number; result?: unknown; error?: { message?: string } };
      const waiting = id === undefined ? undefined : entry.pending.get(id);
      if (!waiting) return;
      entry.pending.delete(id!);
      if (error !== undefined) waiting.reject(new Error(error?.message || 'Translation failed'));
      else waiting.resolve(result);
    });
    worker.addEventListener('error', (event) => this.stop(lang, entry, event?.message || 'Translation worker failed'));
    this.running.set(lang, entry);
    entry.ready = this.call(entry, { type: 'load', lang }).then(() => undefined);
    entry.ready.catch(() => this.stop(lang, entry, 'Translation model failed to load'));
    return entry.ready;
  }

  isLoaded(lang: string): boolean {
    return this.running.has(lang);
  }

  async translate(lang: string, text: string): Promise<string> {
    await this.load(lang);
    const entry = this.running.get(lang);
    if (!entry) throw new Error('Translation worker stopped');
    return String((await this.call(entry, { type: 'translate', text })) ?? '');
  }

  /** Frees one language's model (after its files were deleted, for example). */
  unload(lang: string): void {
    const entry = this.running.get(lang);
    if (entry) this.stop(lang, entry, 'Translation model removed');
  }

  reset(reason = 'Translation worker stopped'): void {
    for (const [lang, entry] of [...this.running]) this.stop(lang, entry, reason);
  }
}
