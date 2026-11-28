import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';

const loopbackFetch = fetch;
let server: Server | undefined;
let service: ReturnType<typeof createApp>;
let base: string;

beforeEach(async () => {
  service = createApp({
    trustProxyHops: 1,
    mt: {
      ipLimitMultiplier: 10,
      mtPerSession: 3,
      cloudDailyChars: 1_000_000,
      mtChain: ['gtx'],
      shortLinkBase: 'https://example.com',
    },
    report: { appVersion: 'test' },
  });
  await new Promise<void>((resolve, reject) => {
    server = service.app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server!.address() as { port: number };
  base = `http://127.0.0.1:${address.port}/api`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  service.close();
  if (server) {
    const instance = server;
    server = undefined;
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  }
});

function post(route: string, body: unknown) {
  return loopbackFetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('translation routes', () => {
  it('accepts Hindi and Bengali as source and target languages', async () => {
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([[['नमस्ते']]]));
    const response = await post('/mt', { text: 'হ্যালো', source: 'bn', lang: 'hi', provider: 'gtx' });
    expect(response.status).toBe(200);
    const url = String((provider.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('sl=bn');
    expect(url).toContain('tl=hi');
  });

  it('publishes the translation config and the app security header', async () => {
    const response = await loopbackFetch(base + '/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(await response.json()).toEqual({
      mtProvider: 'gtx',
      providers: ['gtx'],
      shortLinkBase: 'https://example.com',
    });
  });

  it('validates MT input and returns a cached result for the same source and target', async () => {
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([[['Water freezes.']]]));
    const bad = await post('/mt', { text: 'El agua se congela.', source: 'xx', lang: 'en' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Unsupported source language code: xx' });
    expect(provider).not.toHaveBeenCalled();

    const body = { text: '  El agua se congela.  ', source: 'es', lang: 'en', provider: 'gtx' };
    const first = await post('/mt', body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      translation: 'Water freezes.',
      provider: 'gtx',
      ms: expect.any(Number),
    });
    const second = await post('/mt', body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      translation: 'Water freezes.',
      provider: 'cache',
      ms: expect.any(Number),
    });
    expect(provider).toHaveBeenCalledOnce();
    const url = new URL(String(provider.mock.calls[0][0]));
    expect(url.hostname).toBe('translate.googleapis.com');
    expect(url.searchParams.get('sl')).toBe('es');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('q')).toBe('El agua se congela.');
  });

  it('applies the per-session rate limit before processing requests', async () => {
    expect((await post('/mt', {})).status).toBe(400);
    expect((await post('/mt', {})).status).toBe(400);
    expect((await post('/mt', {})).status).toBe(400);
    const limited = await post('/mt', {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('5');
    expect(await limited.json()).toEqual({ error: 'Rate limit exceeded.' });
  });

  it('no longer offers the old refinement route', async () => {
    const response = await post('/translate', { phrase: 'Water freezes.', targetLangs: ['es'] });
    expect(response.status).toBe(404);
  });
});
