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
  translateGoogleCloud,
  translateGtx,
  type MtProvider,
} from './server/mt';
import { createRateLimiter } from './server/rateLimit';

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

// Per-IP sliding window rate limits.
// The fast MT endpoint is hit once per language per interim chunk, so it gets a much larger budget.
const RATE_LIMIT_WINDOW_MS = 60_000;
const refineLimiter = createRateLimiter(60, RATE_LIMIT_WINDOW_MS);
const mtLimiter = createRateLimiter(900, RATE_LIMIT_WINDOW_MS);

// Periodically prune stale IP entries
setInterval(() => {
  refineLimiter.prune();
  mtLimiter.prune();
}, RATE_LIMIT_WINDOW_MS).unref();

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

const machineTranslator = createMachineTranslator({
  chain: MT_CHAIN,
  callProvider: (provider, text, code) => {
    switch (provider) {
      case 'google-cloud':
        return translateGoogleCloud(text, code, GOOGLE_TRANSLATE_API_KEY!);
      case 'gtx':
        return translateGtx(text, code);
      case 'gemini':
        return translateGeminiSingle(text, code);
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
    if (mtLimiter.isLimited(getClientIp(req))) {
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
      const { translation, provider } = await machineTranslator.translate(
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
    if (refineLimiter.isLimited(getClientIp(req))) {
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
