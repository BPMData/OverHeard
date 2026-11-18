import { ThinkingLevel } from '@google/genai';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';

const generateContent = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@google/genai')>(),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const loopbackFetch = fetch;
let server: Server | undefined;
let service: ReturnType<typeof createApp>;
let base: string;

beforeEach(async () => {
  generateContent.mockReset();
  service = createApp({
    trustProxyHops: 1,
    mt: {
      ipLimitMultiplier: 10,
      refinePerSession: 2,
      mtPerSession: 3,
      cloudDailyChars: 1_000_000,
      geminiDailyCalls: 5_000,
      geminiApiKey: 'test-key',
      mtChain: ['gtx', 'gemini'],
      geminiModel: 'gemini-4-hydrogen',
      geminiThinkingLevel: ThinkingLevel.LOW,
      refineEnabled: true,
      shortLinkBase: 'https://example.com',
    },
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
  it('publishes the translation config and the app security header', async () => {
    const response = await loopbackFetch(base + '/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(await response.json()).toEqual({
      mtProvider: 'gtx',
      providers: ['gtx', 'gemini'],
      refine: true,
      shortLinkBase: 'https://example.com',
    });
  });

  it('validates MT input and returns a cached result for the same source and target', async () => {
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([[['Water freezes.']]]),
    );
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
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('validates refinement input and returns contextual Gemini translations', async () => {
    const bad = await post('/translate', { phrase: 'Water freezes.', targetLangs: ['xx'] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Unsupported language code: xx' });
    expect(generateContent).not.toHaveBeenCalled();

    generateContent.mockResolvedValue({ text: '{"es":" El agua se congela. "}' });
    const response = await post('/translate', {
      phrase: ' Water freezes. ',
      targetLangs: ['es', 'es', 'fr'],
      context: ['Discarded context.', ' Temperature drops. ', 'The liquid cools.'],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      translations: { es: 'El agua se congela.', fr: 'translation unavailable' },
    });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-4-hydrogen',
      contents: [
        'Previous English sentences (DO NOT TRANSLATE — for context and pronoun resolution only):',
        '[Context 1]: "Temperature drops."',
        '[Context 2]: "The liquid cools."',
        '',
        'Target languages: es (Spanish), fr (French)',
        "Teacher's current English sentence to translate:",
        '"Water freezes."',
      ].join('\n'),
      config: expect.objectContaining({
        responseMimeType: 'application/json',
        responseSchema: expect.objectContaining({ required: ['es', 'fr'] }),
      }),
    }));
  });

  it('applies the refinement rate limit before processing requests', async () => {
    expect((await post('/translate', {})).status).toBe(400);
    expect((await post('/translate', {})).status).toBe(400);
    const limited = await post('/translate', {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('5');
    expect(await limited.json()).toEqual({
      error: 'Rate limit exceeded (maximum 2 requests per minute).',
    });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
