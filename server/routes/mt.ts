import type { Express, Request, Response } from 'express';
import { createDailyBudget } from '../budget.ts';
import { SESSION_HEADER, sessionKey } from '../clientKeys.ts';
import {
  createMachineTranslator,
  isMtProvider,
  ProviderBudgetError,
  translateGoogleCloud,
  translateGtx,
} from '../mt.ts';
import type { MtProvider } from '../mt.ts';
import { createRateLimiter } from '../rateLimit.ts';
import type { RateLimiter } from '../rateLimit.ts';
import { createUsageTracker, forwardedCount } from '../usage.ts';

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

const RATE_LIMIT_WINDOW_MS = 60_000;

export interface MtRouteOptions {
  ipLimitMultiplier: number;
  mtPerSession: number;
  cloudDailyChars: number;
  googleTranslateApiKey?: string;
  mtChain: MtProvider[];
  shortLinkBase: string | null;
}

export function registerMtRoutes(app: Express, {
  ipLimitMultiplier: IP_LIMIT_MULTIPLIER,
  mtPerSession: MT_PER_SESSION,
  cloudDailyChars,
  googleTranslateApiKey: GOOGLE_TRANSLATE_API_KEY,
  mtChain: MT_CHAIN,
  shortLinkBase: SHORT_LINK_BASE,
}: MtRouteOptions) {
  const MT_PROVIDER: MtProvider = MT_CHAIN[0];
  const mtSessionLimiter = createRateLimiter(MT_PER_SESSION, RATE_LIMIT_WINDOW_MS);
  const mtIpLimiter = createRateLimiter(MT_PER_SESSION * IP_LIMIT_MULTIPLIER, RATE_LIMIT_WINDOW_MS);

  // Daily spending guard for Cloud Translation (0 = unlimited). Once it is used up the paid
  // service is skipped until midnight UTC. The default is about $20 at list price. It counts in
  // memory, so it starts over whenever the server restarts: Google's own quota is the hard cap.
  const cloudBudget = createDailyBudget(cloudDailyChars);

  const usage = createUsageTracker();

  // Periodically prune stale entries
  const timer = setInterval(() => {
    for (const limiter of [mtSessionLimiter, mtIpLimiter]) {
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

  const machineTranslator = createMachineTranslator({
    chain: MT_CHAIN,
    callProvider: async (provider, text, code, source) => {
      switch (provider) {
        case 'google-cloud':
          if (!cloudBudget.tryUse(text.length)) throw new ProviderBudgetError(provider);
          return translateGoogleCloud(text, code, GOOGLE_TRANSLATE_API_KEY!, source);
        case 'gtx':
          return translateGtx(text, code, source);
      }
    },
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      mtProvider: MT_PROVIDER,
      providers: MT_CHAIN,
      shortLinkBase: SHORT_LINK_BASE,
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

  return () => clearInterval(timer);
}
