import { describe, expect, it, vi } from 'vitest';
import { BergamotWorker, type WorkerLike } from './worker';

type Message = { id: number; name: string; args: unknown[] };

/** Answers like translator-worker.js: { id, result } or { id, error }. */
class FakeWorker implements WorkerLike {
  listeners: Record<string, Array<(event: never) => void>> = { message: [], error: [] };
  calls: Message[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  constructor(private respond: (message: Message) => unknown = () => undefined) {}
  postMessage(message: Message, transfer: Transferable[] = []) {
    this.calls.push(message);
    this.transfers.push(transfer);
    queueMicrotask(() => {
      let reply: object;
      try {
        reply = { id: message.id, result: this.respond(message) };
      } catch (error) {
        reply = { id: message.id, error: { message: (error as Error).message } };
      }
      for (const listener of this.listeners.message) listener({ data: reply } as never);
    });
  }
  addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
    this.listeners[type].push(listener);
  }
  terminate() {
    this.terminated = true;
  }
  fail(message: string) {
    for (const listener of this.listeners.error) listener({ message } as never);
  }
}

const buffers = () => ({ model: new ArrayBuffer(4), lex: new ArrayBuffer(2), vocab: new ArrayBuffer(1) });

describe('BergamotWorker', () => {
  it('initializes once, loads a model with its buffers transferred, and translates', async () => {
    const fake = new FakeWorker(({ name, args }) =>
      name === 'translate' ? [{ target: { text: `ur:${(args[0] as { texts: Array<{ text: string }> }).texts[0].text}` } }] : undefined,
    );
    const worker = new BergamotWorker(() => fake);
    await worker.load('enur', buffers());
    expect(fake.calls.map((c) => c.name)).toEqual(['initialize', 'loadTranslationModel']);
    expect(fake.calls[0].args[0]).toEqual({ cacheSize: 0, useNativeIntGemm: false });
    expect(fake.calls[1].args[0]).toEqual({ from: 'en', to: 'ur' });
    expect(fake.transfers[1]).toHaveLength(3);
    await expect(worker.translate('enur', 'Hello')).resolves.toBe('ur:Hello');
    // Loading again is free
    await worker.load('enur', buffers());
    expect(fake.calls.filter((c) => c.name === 'loadTranslationModel')).toHaveLength(1);
  });

  it('passes source and target vocabularies for Chinese and Japanese', async () => {
    const fake = new FakeWorker();
    const worker = new BergamotWorker(() => fake);
    const src = new ArrayBuffer(1);
    const trg = new ArrayBuffer(2);
    await worker.load('enzh', { model: new ArrayBuffer(4), lex: new ArrayBuffer(2), srcvocab: src, trgvocab: trg });
    const payload = fake.calls[1].args[1] as { vocabs: ArrayBuffer[] };
    expect(payload.vocabs).toEqual([src, trg]);
  });

  it('keeps at most three models, freeing the least recently used', async () => {
    const fake = new FakeWorker(({ name }) => (name === 'translate' ? [{ target: { text: 'x' } }] : undefined));
    const worker = new BergamotWorker(() => fake);
    await worker.load('enes', buffers());
    await worker.load('enpt', buffers());
    await worker.load('enfr', buffers());
    await worker.translate('enes', 'Hi');
    await worker.load('enur', buffers());
    await Promise.resolve();
    expect(worker.isLoaded('enpt')).toBe(false);
    expect(worker.isLoaded('enes')).toBe(true);
    expect(fake.calls.find((c) => c.name === 'freeTranslationModel')?.args[0]).toEqual({ from: 'en', to: 'pt' });
    await expect(worker.translate('enpt', 'Hi')).rejects.toThrow("isn't loaded");
  });

  it('fails waiting calls when the worker crashes, then starts a new one', async () => {
    const workers: FakeWorker[] = [];
    let hang = true;
    const factory = vi.fn(() => {
      const fake = new FakeWorker();
      if (hang) fake.postMessage = function (this: FakeWorker, message: Message) { this.calls.push(message); };
      workers.push(fake);
      return fake;
    });
    const worker = new BergamotWorker(factory);
    const loading = worker.load('enur', buffers());
    workers[0].fail('out of memory');
    await expect(loading).rejects.toThrow('out of memory');
    expect(workers[0].terminated).toBe(true);
    hang = false;
    await worker.load('enur', buffers());
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects an incomplete model', async () => {
    const worker = new BergamotWorker(() => new FakeWorker());
    await expect(worker.load('enur', { model: new ArrayBuffer(1) })).rejects.toThrow('Incomplete');
  });
});
