// Fast machine translation for live captions: providers, fallback chain, cooldowns and cache.
// Kept free of Express/Gemini setup so it can be unit-tested with a fake fetch and clock.

export type MtProvider = 'google-cloud' | 'gtx' | 'gemini';

export const isMtProvider = (value: unknown): value is MtProvider =>
  value === 'google-cloud' || value === 'gtx' || value === 'gemini';

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Order to try providers in. MT_PROVIDER picks the primary ("google-cloud" or "gtx");
 * the others become fallbacks. Default primary: google-cloud when a key is set, otherwise gtx.
 * Gemini is only ever a last resort, and only when it has a key.
 */
export function buildProviderChain(opts: {
  googleKey?: string;
  geminiKey?: string;
  requested?: string;
}): MtProvider[] {
  const available: MtProvider[] = [
    ...(opts.googleKey ? (['google-cloud'] as const) : []),
    'gtx',
    ...(opts.geminiKey ? (['gemini'] as const) : []),
  ];
  const requested = opts.requested?.trim();
  const primary =
    isMtProvider(requested) && available.includes(requested)
      ? requested
      : available[0];
  return [primary, ...available.filter((p) => p !== primary)];
}

// Google's code for Dari is fa-AF; everything else matches our codes.
const GOOGLE_LANG_CODES: Record<string, string> = { prs: 'fa-AF' };
export const toGoogleCode = (code: string) => GOOGLE_LANG_CODES[code] ?? code;

type FetchLike = typeof fetch;

export async function translateGoogleCloud(
  text: string,
  code: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const res = await fetchImpl(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'en',
        target: toGoogleCode(code),
        format: 'text',
      }),
    }
  );
  if (!res.ok) {
    throw new ProviderError(
      `Cloud Translation HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      res.status
    );
  }
  const data = (await res.json()) as {
    data?: { translations?: { translatedText?: string }[] };
  };
  const out = data.data?.translations?.[0]?.translatedText;
  if (!out) throw new Error('Cloud Translation returned no text');
  return out;
}

export async function translateGtx(
  text: string,
  code: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t' +
    `&tl=${encodeURIComponent(toGoogleCode(code))}&q=${encodeURIComponent(text)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new ProviderError(`gtx HTTP ${res.status}`, res.status);
  const data = (await res.json()) as [Array<[string, ...unknown[]]>];
  // Long inputs come back split into several sentence chunks; join them all.
  const out = (data?.[0] ?? []).map((chunk) => chunk?.[0] ?? '').join('');
  if (!out) throw new Error('gtx returned no text');
  return out;
}

/** Errors that mean "this provider won't work for a while" (quota, rate limit, bad key). */
export function isBenchingError(error: unknown): boolean {
  const status = error instanceof ProviderError ? error.status : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    (status === 400 && /API key/i.test(message))
  );
}

export interface MachineTranslatorOptions {
  chain: MtProvider[];
  callProvider: (provider: MtProvider, text: string, code: string) => Promise<string>;
  /** How long a benched provider is skipped. Default 10 minutes. */
  cooldownMs?: number;
  cacheMax?: number;
  now?: () => number;
  log?: Pick<Console, 'log' | 'warn'>;
}

export interface MachineTranslator {
  /** `preferred` (chosen in the UI) jumps to the front of the chain; the rest stay as fallbacks. */
  translate(
    text: string,
    code: string,
    preferred?: MtProvider
  ): Promise<{ translation: string; provider: MtProvider | 'cache' }>;
  /** Providers currently skipped, with the time they'll be retried. */
  cooldowns(): ReadonlyMap<MtProvider, number>;
}

export function createMachineTranslator({
  chain: defaultChain,
  callProvider,
  cooldownMs = 10 * 60_000,
  cacheMax = 5000,
  now = Date.now,
  log = console,
}: MachineTranslatorOptions): MachineTranslator {
  const cooldownUntil = new Map<MtProvider, number>();

  // LRU-ish cache: interim chunks repeat a lot, and the final sentence
  // usually equals the last interim chunk.
  const cache = new Map<string, string>();
  const cacheGet = (key: string) => {
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      cache.set(key, hit);
    }
    return hit;
  };
  const cacheSet = (key: string, value: string) => {
    cache.set(key, value);
    if (cache.size > cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  return {
    cooldowns: () => cooldownUntil,

    async translate(text, code, preferred) {
      const chain =
        preferred && defaultChain.includes(preferred)
          ? [preferred, ...defaultChain.filter((p) => p !== preferred)]
          : defaultChain;
      // Keyed by the first-choice provider so switching translators in the UI gives fresh results.
      const key = `${chain[0]}\u0000${code}\u0000${text}`;
      const cached = cacheGet(key);
      if (cached !== undefined) return { translation: cached, provider: 'cache' };

      const start = now();
      const ready = chain.filter((p) => (cooldownUntil.get(p) ?? 0) <= start);
      // If everything is cooling down, try them all anyway rather than fail outright.
      const order = ready.length > 0 ? ready : chain;

      let lastError: unknown;
      for (const provider of order) {
        try {
          const translation = await callProvider(provider, text, code);
          if (cooldownUntil.has(provider)) {
            cooldownUntil.delete(provider);
            log.log(`[translate] ${provider} is working again`);
          }
          cacheSet(key, translation);
          return { translation, provider };
        } catch (error) {
          lastError = error;
          if (isBenchingError(error)) {
            if ((cooldownUntil.get(provider) ?? 0) <= start) {
              const status = (error as ProviderError).status;
              log.warn(
                `[translate] ${provider} returned ${status} (quota, rate limit or bad key); skipping it for ${
                  cooldownMs / 60_000
                } min`
              );
            }
            cooldownUntil.set(provider, now() + cooldownMs);
          } else {
            log.warn(
              `[translate] ${provider} failed, trying next:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error('All MT providers failed');
    },
  };
}
