import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderChain,
  createMachineTranslator,
  isBenchingError,
  ProviderError,
  toGoogleCode,
  translateGoogleCloud,
  translateGtx,
  type MtProvider,
} from './mt';

const quietLog = { log: () => {}, warn: () => {} };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('buildProviderChain', () => {
  it('uses the free endpoint alone when no keys are set', () => {
    expect(buildProviderChain({})).toEqual(['gtx']);
  });

  it('keeps the free endpoint first even when a Cloud key is set', () => {
    expect(buildProviderChain({ googleKey: 'k' })).toEqual(['gtx', 'google-cloud']);
  });

  it('lets MT_PROVIDER=google-cloud go first and keeps gtx as the fallback', () => {
    expect(buildProviderChain({ googleKey: 'k', requested: 'google-cloud' })).toEqual([
      'google-cloud',
      'gtx',
    ]);
  });

  it('tries free, then Cloud, then Gemini as the last resort', () => {
    expect(buildProviderChain({ googleKey: 'k', geminiKey: 'g' })).toEqual([
      'gtx',
      'google-cloud',
      'gemini',
    ]);
  });

  it('ignores a requested provider that is unknown or unavailable', () => {
    expect(buildProviderChain({ requested: 'google-cloud' })).toEqual(['gtx']);
    expect(buildProviderChain({ googleKey: 'k', requested: 'deepl' })).toEqual([
      'gtx',
      'google-cloud',
    ]);
  });
});

describe('toGoogleCode', () => {
  it('maps Dari to fa-AF and leaves other codes alone', () => {
    expect(toGoogleCode('prs')).toBe('fa-AF');
    expect(toGoogleCode('es')).toBe('es');
  });
});

describe('translateGtx', () => {
  it('joins every sentence chunk of the response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([[['Hola. ', 'Hello. '], ['¿Cómo estás?', 'How are you?']]])
    );
    await expect(translateGtx('Hello. How are you?', 'es', fetchImpl)).resolves.toBe(
      'Hola. ¿Cómo estás?'
    );
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('tl=es');
    expect(url).toContain('q=Hello.%20How%20are%20you%3F');
  });

  it('sends Dari as fa-AF', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([[['سلام', 'Hi']]]));
    await translateGtx('Hi', 'prs', fetchImpl);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('tl=fa-AF');
  });

  it('throws a ProviderError carrying the HTTP status', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow down', { status: 429 }));
    const err = await translateGtx('Hi', 'es', fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
  });

  it('throws when the response has no text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([[]]));
    await expect(translateGtx('Hi', 'es', fetchImpl)).rejects.toThrow('no text');
  });
});

describe('translateGoogleCloud', () => {
  it('posts the text and returns the translation', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { translations: [{ translatedText: 'Olá' }] } })
    );
    await expect(translateGoogleCloud('Hello', 'pt', 'KEY', fetchImpl)).resolves.toBe('Olá');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('key=KEY');
    expect(JSON.parse(String(init.body))).toEqual({
      q: 'Hello',
      source: 'en',
      target: 'pt',
      format: 'text',
    });
  });

  it('turns HTTP errors into ProviderError with the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('quota exceeded', { status: 403 }));
    const err = await translateGoogleCloud('Hello', 'pt', 'KEY', fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(403);
  });
});

describe('isBenchingError', () => {
  it('benches on quota, rate-limit and bad-key errors only', () => {
    expect(isBenchingError(new ProviderError('x', 403))).toBe(true);
    expect(isBenchingError(new ProviderError('x', 429))).toBe(true);
    expect(isBenchingError(new ProviderError('x', 401))).toBe(true);
    expect(isBenchingError(new ProviderError('API key not valid', 400))).toBe(true);
    expect(isBenchingError(new ProviderError('bad request', 400))).toBe(false);
    expect(isBenchingError(new ProviderError('oops', 500))).toBe(false);
    expect(isBenchingError(new Error('network down'))).toBe(false);
  });
});

describe('createMachineTranslator', () => {
  const setup = (
    chain: MtProvider[],
    behavior: Partial<Record<MtProvider, () => Promise<string>>>
  ) => {
    let clock = 1_000_000;
    const callProvider = vi.fn(async (provider: MtProvider) => {
      const fn = behavior[provider];
      if (!fn) throw new Error(`${provider} not stubbed`);
      return fn();
    });
    const translator = createMachineTranslator({
      chain,
      callProvider,
      cooldownMs: 60_000,
      now: () => clock,
      log: quietLog,
    });
    return {
      translator,
      callProvider,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('moves on and benches a provider that is too slow, but lets the last one finish', async () => {
    const callProvider = vi.fn(async (provider: MtProvider) => {
      if (provider === 'gtx') return new Promise<string>(() => {}); // never answers
      if (provider === 'gemini') {
        return new Promise<string>((resolve) => setTimeout(() => resolve('Hola (gemini)'), 60));
      }
      throw new ProviderError('server error', 500);
    });
    const translator = createMachineTranslator({
      chain: ['gtx', 'google-cloud', 'gemini'],
      callProvider,
      timeoutMs: 20,
      log: quietLog,
    });
    await expect(translator.translate('Hello', 'es')).resolves.toEqual({
      translation: 'Hola (gemini)',
      provider: 'gemini',
    });
    expect(translator.cooldowns().has('gtx')).toBe(true);
    expect(translator.cooldowns().has('google-cloud')).toBe(false);
  });

  it('returns the first provider that succeeds', async () => {
    const { translator } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => 'Hola',
    });
    await expect(translator.translate('Hello', 'es')).resolves.toEqual({
      translation: 'Hola',
      provider: 'google-cloud',
    });
  });

  it('falls back to the next provider on an ordinary error without benching', async () => {
    const { translator, callProvider } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => {
        throw new ProviderError('server error', 500);
      },
      gtx: async () => 'Hola',
    });
    await expect(translator.translate('Hello', 'es')).resolves.toMatchObject({
      provider: 'gtx',
    });
    expect(translator.cooldowns().size).toBe(0);
    // Next request still tries Cloud first
    await translator.translate('Goodbye', 'es');
    expect(callProvider.mock.calls.map((c) => c[0])).toEqual([
      'google-cloud',
      'gtx',
      'google-cloud',
      'gtx',
    ]);
  });

  it('benches a provider after a quota error and retries it once the cooldown ends', async () => {
    let cloudQuotaExceeded = true;
    const { translator, callProvider, advance } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => {
        if (cloudQuotaExceeded) throw new ProviderError('quota', 429);
        return 'Hola (cloud)';
      },
      gtx: async () => 'Hola (gtx)',
    });

    await translator.translate('one', 'es');
    expect(translator.cooldowns().has('google-cloud')).toBe(true);

    // While benched, Cloud isn't called at all
    callProvider.mockClear();
    await expect(translator.translate('two', 'es')).resolves.toMatchObject({
      provider: 'gtx',
    });
    expect(callProvider.mock.calls.map((c) => c[0])).toEqual(['gtx']);

    // After the cooldown, Cloud is tried again and un-benched on success
    cloudQuotaExceeded = false;
    advance(60_001);
    await expect(translator.translate('three', 'es')).resolves.toEqual({
      translation: 'Hola (cloud)',
      provider: 'google-cloud',
    });
    expect(translator.cooldowns().has('google-cloud')).toBe(false);
  });

  it('still tries every provider when all of them are benched', async () => {
    let calls = 0;
    const { translator } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => {
        throw new ProviderError('quota', 403);
      },
      gtx: async () => {
        calls += 1;
        if (calls === 1) throw new ProviderError('rate limited', 429);
        return 'Hola';
      },
    });
    await expect(translator.translate('one', 'es')).rejects.toThrow('rate limited');
    await expect(translator.translate('two', 'es')).resolves.toMatchObject({
      provider: 'gtx',
    });
  });

  it('moves the preferred provider to the front for that request', async () => {
    const { translator, callProvider } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => 'cloud',
      gtx: async () => 'gtx',
    });
    await expect(translator.translate('Hello', 'es', 'gtx')).resolves.toMatchObject({
      provider: 'gtx',
    });
    expect(callProvider).toHaveBeenCalledTimes(1);
  });

  it('ignores a preferred provider that is not in the chain', async () => {
    const { translator } = setup(['gtx'], { gtx: async () => 'Hola' });
    await expect(translator.translate('Hello', 'es', 'google-cloud')).resolves.toMatchObject({
      provider: 'gtx',
    });
  });

  it('serves repeats from the cache, separately per first-choice provider', async () => {
    const { translator, callProvider } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => 'cloud',
      gtx: async () => 'gtx',
    });
    await translator.translate('Hello', 'es');
    await expect(translator.translate('Hello', 'es')).resolves.toEqual({
      translation: 'cloud',
      provider: 'cache',
    });
    // Switching translator gives a fresh result instead of the other provider's cached one
    await expect(translator.translate('Hello', 'es', 'gtx')).resolves.toEqual({
      translation: 'gtx',
      provider: 'gtx',
    });
    // Different language is a different cache entry
    await translator.translate('Hello', 'pt');
    expect(callProvider).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when every provider fails', async () => {
    const { translator } = setup(['google-cloud', 'gtx'], {
      'google-cloud': async () => {
        throw new Error('cloud down');
      },
      gtx: async () => {
        throw new Error('gtx down');
      },
    });
    await expect(translator.translate('Hello', 'es')).rejects.toThrow('gtx down');
  });
});

describe('bidirectional translation', () => {
  it('sends the source language to GTX and Cloud', async () => {
    const gtxFetch = vi.fn(async () => jsonResponse([[['Hello', 'Hola']]]));
    await translateGtx('Hola', 'en', 'es', gtxFetch);
    expect(String((gtxFetch.mock.calls[0] as unknown[])[0])).toContain('sl=es');
    expect(String((gtxFetch.mock.calls[0] as unknown[])[0])).toContain('tl=en');
    const cloudFetch = vi.fn(async () => jsonResponse({ data: { translations: [{ translatedText: 'Hello' }] } }));
    await translateGoogleCloud('Hola', 'en', 'KEY', 'es', cloudFetch);
    const init = (cloudFetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ source: 'es', target: 'en' });
  });

  it('isolates language pairs and passes the source to every provider including Gemini', async () => {
    const callProvider = vi.fn(async (_provider: MtProvider, _text: string, target: string, source: string) => `${source}>${target}`);
    const translator = createMachineTranslator({ chain: ['gemini'], callProvider, log: quietLog });
    expect((await translator.translate('same', 'en', undefined, 'es')).translation).toBe('es>en');
    expect((await translator.translate('same', 'es')).translation).toBe('en>es');
    // Same target and text, different source must also miss the cache.
    expect((await translator.translate('same', 'en', undefined, 'fr')).translation).toBe('fr>en');
    expect((await translator.translate('same', 'en', undefined, 'es')).provider).toBe('cache');
    expect(callProvider).toHaveBeenCalledTimes(3);
    expect(callProvider).toHaveBeenCalledWith('gemini', 'same', 'en', 'es');
  });
});
