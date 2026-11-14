import 'dotenv/config';
import fs from 'fs';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import {
  buildProviderChain,
  createMachineTranslator,
  isMtProvider,
  ProviderBudgetError,
  translateGoogleCloud,
  translateGtx,
  type MtProvider,
} from './server/mt.ts';
import { createGeminiSingleTranslator } from './server/geminiSingle.ts';
import { createDailyBudget } from './server/budget.ts';
import { intFromEnv } from './server/config.ts';
import { createUsageTracker, forwardedCount } from './server/usage.ts';
import { createRateLimiter, type RateLimiter } from './server/rateLimit.ts';
import { SESSION_HEADER, sessionKey } from './server/clientKeys.ts';

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

// Sliding-window rate limits, applied per browser session AND per IP.
// - Per session: one teacher's budget. A school usually shares one public IP, so limiting
//   by IP alone would make every teacher in the building share a single budget.
// - Per IP: a looser backstop (about 10 teachers' worth), because session IDs come from the
//   client and can be rotated to dodge the per-session limit.
// The fast MT endpoint is hit once per language per interim chunk, so it gets a much larger budget.
// All of these can be changed with environment variables, without rebuilding the app.
const RATE_LIMIT_WINDOW_MS = 60_000;
const IP_LIMIT_MULTIPLIER = Math.max(1, intFromEnv(process.env.RATE_LIMIT_IP_MULTIPLIER, 10));
const REFINE_PER_SESSION = Math.max(1, intFromEnv(process.env.RATE_LIMIT_REFINE_PER_SESSION, 60));
const MT_PER_SESSION = Math.max(1, intFromEnv(process.env.RATE_LIMIT_MT_PER_SESSION, 900));
// How many proxies sit in front of this server and can be trusted to report the real client
// address. Cloud Run's front end is one. Too low and every user looks like the same visitor.
const TRUST_PROXY_HOPS = intFromEnv(process.env.TRUST_PROXY_HOPS, 1);
const refineSessionLimiter = createRateLimiter(REFINE_PER_SESSION, RATE_LIMIT_WINDOW_MS);
const mtSessionLimiter = createRateLimiter(MT_PER_SESSION, RATE_LIMIT_WINDOW_MS);
const refineIpLimiter = createRateLimiter(
  REFINE_PER_SESSION * IP_LIMIT_MULTIPLIER,
  RATE_LIMIT_WINDOW_MS
);
const mtIpLimiter = createRateLimiter(MT_PER_SESSION * IP_LIMIT_MULTIPLIER, RATE_LIMIT_WINDOW_MS);

// Daily spending guards for the paid services (0 = unlimited). Once a budget is used up the
// paid service is skipped until midnight UTC and captions continue on the free translator.
// Defaults are guesses: about $20 of Cloud Translation at list price, and a few thousand
// Gemini calls. Raise or lower them to taste.
const cloudBudget = createDailyBudget(intFromEnv(process.env.CLOUD_TRANSLATE_DAILY_CHARS, 1_000_000));
const geminiBudget = createDailyBudget(intFromEnv(process.env.GEMINI_DAILY_CALLS, 5_000));

const usage = createUsageTracker();

// Periodically prune stale entries
setInterval(() => {
  for (const limiter of [refineSessionLimiter, mtSessionLimiter, refineIpLimiter, mtIpLimiter]) {
    limiter.prune();
  }
  // One line per busy minute: who's using it, which translators did the work, any throttling
  const summary = usage.flush();
  if (summary) {
    console.log(
      '[usage]',
      JSON.stringify({
        ...summary,
        cloudCharsToday: `${cloudBudget.used()}/${cloudBudget.limit || 'unlimited'}`,
        geminiCallsToday: `${geminiBudget.used()}/${geminiBudget.limit || 'unlimited'}`,
      })
    );
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// With `trust proxy` set to TRUST_PROXY_HOPS, req.ip is the address the outermost trusted
// proxy saw. Never read the left-most X-Forwarded-For entry yourself: the client controls it.
function getClientIp(req: Request): string {
  return req.ip || 'unknown';
}

function isRateLimited(
  req: Request,
  ipLimiter: RateLimiter,
  sessionLimiter: RateLimiter
): boolean {
  const ip = getClientIp(req);
  return (
    ipLimiter.isLimited(ip) ||
    sessionLimiter.isLimited(sessionKey(req.headers[SESSION_HEADER], ip))
  );
}

/** Rate-limit check for an API request; also records who is using the server. */
function rejectIfLimited(
  req: Request,
  res: Response,
  ipLimiter: RateLimiter,
  sessionLimiter: RateLimiter,
  message: string
): boolean {
  usage.seenSession(sessionKey(req.headers[SESSION_HEADER], getClientIp(req)));
  usage.forwardedEntries(forwardedCount(req.headers['x-forwarded-for']));
  if (!isRateLimited(req, ipLimiter, sessionLimiter)) return false;
  usage.rateLimited();
  res.set('Retry-After', '5');
  res.status(429).json({ error: message });
  return true;
}

// ---------------------------------------------------------------------------
// Fast machine translation (the live caption path)
// ---------------------------------------------------------------------------
// Providers, tried in this order until one succeeds:
//   1. gtx: the free, unofficial translate.googleapis.com endpoint Google Translate's
//      web widget uses. No key, but undocumented and can be throttled or blocked.
//   2. google-cloud: Google Cloud Translation API (needs GOOGLE_TRANSLATE_API_KEY) — official, paid.
//   3. gemini: minimal-thinking Gemini — slowest, last resort (needs GEMINI_API_KEY).
// A provider that errors, hits a quota, or takes over 2.5 s is skipped; quota errors and
// slow responses bench it for 10 minutes. MT_PROVIDER="google-cloud" moves Cloud to the front.
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();

const MT_CHAIN = buildProviderChain({
  googleKey: GOOGLE_TRANSLATE_API_KEY,
  geminiKey: process.env.GEMINI_API_KEY,
  requested: process.env.MT_PROVIDER,
});
const MT_PROVIDER: MtProvider = MT_CHAIN[0];

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

const translateGeminiSingle = createGeminiSingleTranslator({
  generateContent: (request) => getGenAIClient().models.generateContent(request),
  model: GEMINI_MODEL,
  thinkingLevel: GEMINI_THINKING_LEVEL,
  languages: SUPPORTED_LANGUAGES,
});

const machineTranslator = createMachineTranslator({
  chain: MT_CHAIN,
  callProvider: async (provider, text, code, source) => {
    switch (provider) {
      case 'google-cloud':
        if (!cloudBudget.tryUse(text.length)) throw new ProviderBudgetError(provider);
        return translateGoogleCloud(text, code, GOOGLE_TRANSLATE_API_KEY!, source);
      case 'gtx':
        return translateGtx(text, code, source);
      case 'gemini':
        if (!geminiBudget.tryUse(1)) throw new ProviderBudgetError(provider);
        return translateGeminiSingle(text, code, source);
    }
  },
});

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
  // Trust only the proxy hops we expect in front of us (Cloud Run's front end is one)
  app.set('trust proxy', TRUST_PROXY_HOPS);
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
    if (rejectIfLimited(req, res, mtIpLimiter, mtSessionLimiter, 'Rate limit exceeded.')) return;

    const { text, lang, source = 'en', provider: requestedProvider } = req.body ?? {};
    if (typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Text must be a non-empty string.' });
      return;
    }
    if (typeof lang !== 'string' || (lang !== 'en' && !Object.hasOwn(SUPPORTED_LANGUAGES, lang))) {
      res.status(400).json({ error: `Unsupported language code: ${String(lang)}` });
      return;
    }

    if (typeof source !== 'string' || (source !== 'en' && !Object.hasOwn(SUPPORTED_LANGUAGES, source))) {
      res.status(400).json({ error: `Unsupported source language code: ${String(source)}` });
      return;
    }
    if (source === lang) {
      res.status(400).json({ error: 'Source and target languages must differ.' });
      return;
    }

    const started = Date.now();
    try {
      const { translation, provider } = await machineTranslator.translate(
        text.trim().slice(0, 500),
        lang,
        isMtProvider(requestedProvider) ? requestedProvider : undefined,
        source
      );
      usage.mtOk(provider, text.trim().slice(0, 500).length);
      res.json({ translation, provider, ms: Date.now() - started });
    } catch (error: unknown) {
      usage.mtFailed();
      const errMessage = error instanceof Error ? error.message : 'MT request failed';
      console.error('[/api/mt] all providers failed:', errMessage);
      res.status(502).json({ error: 'Translation unavailable', details: errMessage });
    }
  });

  // Slow path: context-aware Gemini refinement of a finished sentence.
  app.post('/api/translate', async (req: Request, res: Response) => {
    if (
      rejectIfLimited(
        req,
        res,
        refineIpLimiter,
        refineSessionLimiter,
        `Rate limit exceeded (maximum ${REFINE_PER_SESSION} requests per minute).`
      )
    )
      return;

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

    if (!geminiBudget.tryUse(1)) {
      usage.refine(false);
      res.status(429).json({ error: 'Daily Gemini budget reached.' });
      return;
    }

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

      usage.refine(true);
      res.json({ translations });
    } catch (error: unknown) {
      usage.refine(false);
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
      `[limits] per tab/min: ${MT_PER_SESSION} translations, ${REFINE_PER_SESSION} refinements; per IP: ${IP_LIMIT_MULTIPLIER}x; ` +
        `trusted proxy hops: ${TRUST_PROXY_HOPS}; daily caps: ${cloudBudget.limit || 'unlimited'} Cloud Translation chars, ` +
        `${geminiBudget.limit || 'unlimited'} Gemini calls`
    );
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
