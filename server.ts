import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThinkingLevel } from '@google/genai';
import { createApp } from './server/app.ts';
import { intFromEnv } from './server/config.ts';
import { buildProviderChain } from './server/mt.ts';
import { shortLinkBase } from './server/shortLink.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Sliding-window rate limits, applied per browser session AND per IP.
// - Per session: one teacher's budget. A school usually shares one public IP, so limiting
//   by IP alone would make every teacher in the building share a single budget.
// - Per IP: a looser backstop (about 10 teachers' worth), because session IDs come from the
//   client and can be rotated to dodge the per-session limit.
// The fast MT endpoint is hit once per language per interim chunk, so it gets a much larger budget.
// All of these can be changed with environment variables, without rebuilding the app.
const IP_LIMIT_MULTIPLIER = Math.max(1, intFromEnv(process.env.RATE_LIMIT_IP_MULTIPLIER, 10));
const REFINE_PER_SESSION = Math.max(1, intFromEnv(process.env.RATE_LIMIT_REFINE_PER_SESSION, 60));
const MT_PER_SESSION = Math.max(1, intFromEnv(process.env.RATE_LIMIT_MT_PER_SESSION, 900));
const SHORT_LINK_BASE = shortLinkBase();
// How many proxies sit in front of this server and can be trusted to report the real client
// address. Cloud Run's front end is one. Too low and every user looks like the same visitor.
const TRUST_PROXY_HOPS = intFromEnv(process.env.TRUST_PROXY_HOPS, 1);

const CLOUD_DAILY_CHARS = intFromEnv(process.env.CLOUD_TRANSLATE_DAILY_CHARS, 1_000_000);
const GEMINI_DAILY_CALLS = intFromEnv(process.env.GEMINI_DAILY_CALLS, 5_000);

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
const MT_PROVIDER = MT_CHAIN[0];

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

async function startServer() {
  const distPath = path.join(__dirname, 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    (process.env.NODE_ENV !== 'development' && Boolean(process.env.K_SERVICE));

  const serveBuiltApp = isProd && fs.existsSync(path.join(distPath, 'index.html'));
  const { app, close } = createApp({
    trustProxyHops: TRUST_PROXY_HOPS,
    distPath: serveBuiltApp ? distPath : undefined,
    mt: {
      ipLimitMultiplier: IP_LIMIT_MULTIPLIER,
      refinePerSession: REFINE_PER_SESSION,
      mtPerSession: MT_PER_SESSION,
      cloudDailyChars: CLOUD_DAILY_CHARS,
      geminiDailyCalls: GEMINI_DAILY_CALLS,
      googleTranslateApiKey: GOOGLE_TRANSLATE_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      mtChain: MT_CHAIN,
      geminiModel: GEMINI_MODEL,
      geminiThinkingLevel: GEMINI_THINKING_LEVEL,
      refineEnabled: REFINE_ENABLED,
      shortLinkBase: SHORT_LINK_BASE,
    },
  });

  if (!serveBuiltApp) {
    const { configureDevelopment } = await import('./server/development.ts');
    await configureDevelopment(app, __dirname);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`OverHeard server running on http://0.0.0.0:${PORT}`);
    console.log(
      `[limits] per tab/min: ${MT_PER_SESSION} translations, ${REFINE_PER_SESSION} refinements; per IP: ${IP_LIMIT_MULTIPLIER}x; ` +
        `trusted proxy hops: ${TRUST_PROXY_HOPS}; daily caps: ${CLOUD_DAILY_CHARS || 'unlimited'} Cloud Translation chars, ` +
        `${GEMINI_DAILY_CALLS || 'unlimited'} Gemini calls`
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
  server.once('close', close);
}

startServer();
