import 'dotenv/config';
import fs from 'fs';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const SUPPORTED_LANGUAGES: Record<string, string> = {
  es: 'Spanish',
  pt: 'Portuguese',
  ar: 'Arabic',
  zh: 'Simplified Chinese',
  vi: 'Vietnamese',
  ht: 'Haitian Creole',
  fr: 'French',
  uk: 'Ukrainian',
  ru: 'Russian',
  so: 'Somali',
  prs: 'Dari',
  ps: 'Pashto',
};

const SYSTEM_INSTRUCTION =
  "You are a classroom interpreter. Translate the teacher's English into each target language. Natural, student-friendly, keep subject vocabulary accurate. The context sentences are for reference only — do not translate them. Output only JSON.";

// Per-IP sliding window rate limiters.
// The fast MT endpoint is hit once per language per interim chunk, so it gets a much larger budget.
const RATE_LIMIT_WINDOW_MS = 60_000;
const REFINE_MAX_REQUESTS = 60;
const MT_MAX_REQUESTS = 900;
const refineBucket = new Map<string, number[]>();
const mtBucket = new Map<string, number[]>();

function isRateLimited(
  bucket: Map<string, number[]>,
  ip: string,
  max: number
): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (bucket.get(ip) || []).filter((t) => t > windowStart);
  if (timestamps.length >= max) {
    bucket.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  bucket.set(ip, timestamps);
  return false;
}

// Periodically prune stale IP entries
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const bucket of [refineBucket, mtBucket]) {
    for (const [ip, times] of bucket.entries()) {
      const valid = times.filter((t) => t > cutoff);
      if (valid.length === 0) bucket.delete(ip);
      else bucket.set(ip, valid);
    }
  }
}, 60_000).unref();

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Fast machine translation (the live caption path)
// ---------------------------------------------------------------------------
// Providers, tried in order until one succeeds:
//   - google-cloud: Google Cloud Translation API (needs GOOGLE_TRANSLATE_API_KEY) — official.
//   - gtx: the free, unofficial translate.googleapis.com endpoint Google Translate's
//     web widget uses. No key, but undocumented and can be throttled or blocked.
//   - gemini: minimal-thinking Gemini — slowest, last resort (needs GEMINI_API_KEY).
// MT_PROVIDER picks the primary ("google-cloud" or "gtx"); the others become fallbacks.
// Default primary: google-cloud when a key is set, otherwise gtx.
type MtProvider = 'google-cloud' | 'gtx' | 'gemini';

const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();

function buildProviderChain(): MtProvider[] {
  const requested = process.env.MT_PROVIDER?.trim() as MtProvider | undefined;
  const available: MtProvider[] = [
    ...(GOOGLE_TRANSLATE_API_KEY ? (['google-cloud'] as const) : []),
    'gtx',
    ...(process.env.GEMINI_API_KEY ? (['gemini'] as const) : []),
  ];
  const primary =
    requested && available.includes(requested) ? requested : available[0];
  return [primary, ...available.filter((p) => p !== primary)];
}

const MT_CHAIN = buildProviderChain();
const MT_PROVIDER: MtProvider = MT_CHAIN[0];

// When a provider says "quota exceeded / rate limited / forbidden", stop trying it for a
// while so every caption doesn't pay for a doomed request before falling back.
const QUOTA_COOLDOWN_MS = 10 * 60_000;
const providerCooldownUntil = new Map<MtProvider, number>();

class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
const GEMINI_THINKING_LEVEL = /gemini-4-/.test(GEMINI_MODEL)
  ? ThinkingLevel.LOW
  : ThinkingLevel.MINIMAL;

// Gemini refinement replaces the fast MT text with a context-aware translation
// once a sentence is final. It never delays the first caption.
const REFINE_ENABLED =
  Boolean(process.env.GEMINI_API_KEY) &&
  MT_PROVIDER !== 'gemini' &&
  process.env.REFINE_WITH_GEMINI !== 'false';

// Google's code for Dari is fa-AF; everything else matches our codes.
const GOOGLE_LANG_CODES: Record<string, string> = { prs: 'fa-AF' };
const toGoogleCode = (code: string) => GOOGLE_LANG_CODES[code] ?? code;

// Small server-side cache: interim chunks repeat a lot, and the final sentence
// usually equals the last interim chunk.
const MT_CACHE_MAX = 5000;
const mtCache = new Map<string, string>();
function cacheGet(key: string): string | undefined {
  const hit = mtCache.get(key);
  if (hit !== undefined) {
    mtCache.delete(key);
    mtCache.set(key, hit);
  }
  return hit;
}
function cacheSet(key: string, value: string) {
  mtCache.set(key, value);
  if (mtCache.size > MT_CACHE_MAX) {
    const oldest = mtCache.keys().next().value;
    if (oldest !== undefined) mtCache.delete(oldest);
  }
}

async function translateGoogleCloud(text: string, code: string): Promise<string> {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(
      GOOGLE_TRANSLATE_API_KEY!
    )}`,
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

async function translateGtx(text: string, code: string): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t' +
    `&tl=${encodeURIComponent(toGoogleCode(code))}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new ProviderError(`gtx HTTP ${res.status}`, res.status);
  const data = (await res.json()) as [Array<[string, ...unknown[]]>];
  // Long inputs come back split into several sentence chunks; join them all.
  const out = (data?.[0] ?? []).map((chunk) => chunk?.[0] ?? '').join('');
  if (!out) throw new Error('gtx returned no text');
  return out;
}

async function translateGeminiSingle(text: string, code: string): Promise<string> {
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Translate into ${SUPPORTED_LANGUAGES[code]}. Output only the translation.\n\n${text}`,
    config: {
      systemInstruction:
        'You are a classroom interpreter. Natural, student-friendly, keep subject vocabulary accurate.',
      thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
    },
  });
  const out = (response.text ?? '').trim();
  if (!out) throw new Error('Gemini returned no text');
  return out;
}

function callProvider(provider: MtProvider, text: string, code: string) {
  switch (provider) {
    case 'google-cloud':
      return translateGoogleCloud(text, code);
    case 'gtx':
      return translateGtx(text, code);
    case 'gemini':
      return translateGeminiSingle(text, code);
  }
}

const isMtProvider = (value: unknown): value is MtProvider =>
  value === 'google-cloud' || value === 'gtx' || value === 'gemini';

// `preferred` (chosen in the UI) jumps to the front of the chain for this request;
// the remaining providers stay as fallbacks.
async function machineTranslate(
  text: string,
  code: string,
  preferred?: MtProvider
): Promise<{ translation: string; provider: MtProvider | 'cache' }> {
  const chain =
    preferred && MT_CHAIN.includes(preferred)
      ? [preferred, ...MT_CHAIN.filter((p) => p !== preferred)]
      : MT_CHAIN;
  // Keyed by the first-choice provider so switching translators in the UI gives fresh results.
  const key = `${chain[0]}\u0000${code}\u0000${text}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return { translation: cached, provider: 'cache' };

  const now = Date.now();
  const ready = chain.filter((p) => (providerCooldownUntil.get(p) ?? 0) <= now);
  // If everything is cooling down, try them all anyway rather than fail outright.
  const order = ready.length > 0 ? ready : chain;

  let lastError: unknown;
  for (const provider of order) {
    try {
      const translation = await callProvider(provider, text, code);
      if (providerCooldownUntil.has(provider)) {
        providerCooldownUntil.delete(provider);
        console.log(`[translate] ${provider} is working again`);
      }
      cacheSet(key, translation);
      return { translation, provider };
    } catch (error) {
      lastError = error;
      const status = error instanceof ProviderError ? error.status : undefined;
      const message = error instanceof Error ? error.message : '';
      const benched =
        status === 401 ||
        status === 403 ||
        status === 429 ||
        (status === 400 && /API key/i.test(message));
      if (benched) {
        if ((providerCooldownUntil.get(provider) ?? 0) <= now) {
          console.warn(
            `[translate] ${provider} returned ${status} (quota, rate limit or bad key); skipping it for ${
              QUOTA_COOLDOWN_MS / 60_000
            } min`
          );
        }
        providerCooldownUntil.set(provider, Date.now() + QUOTA_COOLDOWN_MS);
      } else {
        console.warn(
          `[translate] ${provider} failed, trying next:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All MT providers failed');
}

let aiClient: GoogleGenAI | null = null;
function getGenAIClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      mtProvider: MT_PROVIDER,
      providers: MT_CHAIN,
      refine: REFINE_ENABLED,
    });
  });

  // Fast path: one language per request so the client can fire them in parallel
  // and paint each column the moment its translation lands.
  app.post('/api/mt', async (req: Request, res: Response) => {
    if (isRateLimited(mtBucket, getClientIp(req), MT_MAX_REQUESTS)) {
      res.status(429).json({ error: 'Rate limit exceeded.' });
      return;
    }

    const { text, lang, provider: requestedProvider } = req.body ?? {};
    if (typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Text must be a non-empty string.' });
      return;
    }
    if (typeof lang !== 'string' || !SUPPORTED_LANGUAGES[lang]) {
      res.status(400).json({ error: `Unsupported language code: ${String(lang)}` });
      return;
    }

    const started = Date.now();
    try {
      const { translation, provider } = await machineTranslate(
        text.trim().slice(0, 500),
        lang,
        isMtProvider(requestedProvider) ? requestedProvider : undefined
      );
      res.json({ translation, provider, ms: Date.now() - started });
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : 'MT request failed';
      console.error('[/api/mt] all providers failed:', errMessage);
      res.status(502).json({ error: 'Translation unavailable', details: errMessage });
    }
  });

  // Slow path: context-aware Gemini refinement of a finished sentence.
  app.post('/api/translate', async (req: Request, res: Response) => {
    if (isRateLimited(refineBucket, getClientIp(req), REFINE_MAX_REQUESTS)) {
      res.status(429).json({
        error: 'Rate limit exceeded (maximum 60 requests per minute).',
      });
      return;
    }

    const { phrase, targetLangs, context } = req.body ?? {};

    if (typeof phrase !== 'string' || phrase.trim().length === 0) {
      res.status(400).json({ error: 'Phrase must be a non-empty string.' });
      return;
    }

    const trimmedPhrase = phrase.trim();
    if (trimmedPhrase.length > 500) {
      res.status(400).json({
        error: 'Phrase exceeds the 500-character maximum limit.',
      });
      return;
    }

    if (!Array.isArray(targetLangs) || targetLangs.length === 0) {
      res.status(400).json({
        error: 'At least one target language code is required.',
      });
      return;
    }

    if (targetLangs.length > 3) {
      res.status(400).json({
        error: 'A maximum of 3 target languages is allowed per request.',
      });
      return;
    }

    const validatedLangs: string[] = [];
    for (const code of targetLangs) {
      if (typeof code !== 'string' || !SUPPORTED_LANGUAGES[code]) {
        res.status(400).json({
          error: `Unsupported language code: ${String(code)}`,
        });
        return;
      }
      if (!validatedLangs.includes(code)) {
        validatedLangs.push(code);
      }
    }

    const contextSentences: string[] = Array.isArray(context)
      ? context
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .slice(-2)
          .map((c) => c.trim().slice(0, 500))
      : [];

    const properties: Record<string, Schema> = {};
    for (const code of validatedLangs) {
      properties[code] = {
        type: Type.STRING,
        description: `Accurate, natural student-friendly translation in ${SUPPORTED_LANGUAGES[code]} (${code}).`,
      };
    }

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties,
      required: validatedLangs,
    };

    const targetDescription = validatedLangs
      .map((code) => `${code} (${SUPPORTED_LANGUAGES[code]})`)
      .join(', ');

    const contextBlock =
      contextSentences.length > 0
        ? `Previous English sentences (DO NOT TRANSLATE — for context and pronoun resolution only):\n${contextSentences
            .map((line, i) => `[Context ${i + 1}]: "${line}"`)
            .join('\n')}\n\n`
        : '';

    const prompt = `${contextBlock}Target languages: ${targetDescription}\nTeacher's current English sentence to translate:\n"${trimmedPhrase}"`;

    try {
      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as Record<string, string>;

      const translations: Record<string, string> = {};
      for (const code of validatedLangs) {
        const val = parsed[code];
        translations[code] =
          typeof val === 'string' && val.trim().length > 0
            ? val.trim()
            : 'translation unavailable';
      }

      res.json({ translations });
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error ? error.message : 'Translation request failed';
      console.error('[/api/translate] Gemini error:', errMessage);
      res.status(502).json({
        error: 'Translation unavailable',
        details: errMessage,
      });
    }
  });

  const distPath = path.join(__dirname, 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start';

  if (isProd && fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OverHeard server running on http://0.0.0.0:${PORT}`);
    console.log(
      `[translate] live MT providers: ${MT_CHAIN.join(' → ')}; Gemini refine: ${REFINE_ENABLED ? `on (${GEMINI_MODEL})` : 'off'}`
    );
    if (MT_PROVIDER === 'gtx') {
      console.warn(
        '[translate] Primary is the unofficial gtx endpoint — free, but Google can throttle or block it without notice.'
      );
    }
  });
}

startServer();
