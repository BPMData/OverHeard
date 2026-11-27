import { describe, expect, it } from 'vitest';
import { downloadMmsModel } from './mmsEngine';

// A response whose body is `size` bytes in 4 chunks, with the given Content-Length header.
function fakeFetch(size: number, contentLength: number): typeof fetch {
  return (async () => {
    const chunk = Math.ceil(size / 4);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < size; at += chunk) controller.enqueue(new Uint8Array(Math.min(chunk, size - at)).fill(7));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-length': String(contentLength) } });
  }) as typeof fetch;
}

describe('downloadMmsModel', () => {
  it('accepts a gzipped download whose Content-Length is the compressed size', async () => {
    const progress: number[] = [];
    const bytes = await downloadMmsModel(
      'https://x.test/m.onnx',
      1000,
      (pct) => progress.push(pct),
      fakeFetch(1000, 850)
    );
    expect(bytes.length).toBe(1000);
    expect(bytes[999]).toBe(7);
    expect(progress.at(-1)).toBe(99);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('rejects a download that stops short of the expected size', async () => {
    await expect(
      downloadMmsModel('https://x.test/m.onnx', 1000, () => undefined, fakeFetch(600, 1000))
    ).rejects.toThrow('interrupted');
  });

  it('reports an HTTP error', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(downloadMmsModel('https://x.test/m.onnx', 1000, () => undefined, notFound)).rejects.toThrow(
      'HTTP 404'
    );
  });
});
