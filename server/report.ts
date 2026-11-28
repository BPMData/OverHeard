import express from 'express';
import type { Express, Request, Response } from 'express';
import { createRateLimiter } from './rateLimit.ts';
import {
  normalizeReport,
  privateEmailSubject,
  publicIssueBody,
  publicIssueTitle,
  REPORT_APP_NAME,
  REPORT_LABEL,
  reportAsText,
} from '../src/report/protocol.ts';
import type { ProblemReport } from '../src/report/protocol.ts';

// "Something not working?" reports. The browser never sees a credential: this server sends each
// report to the shared report relay (OverBoard's Apps Script, which also serves AllAboard and
// AllHail) with a shared secret. The relay opens the public GitHub issue from `issue` with its own
// token and emails `email` (contact details and private comments) to the shared reporting inbox.
// Without the relay settings the form falls back to Copy/Download and a manual email.

export interface ReportRouteOptions {
  /** The shared relay's Apps Script /exec URL (REPORT_RELAY_URL). */
  relayUrl?: string;
  /** Shared secret the relay checks for OverHeard (REPORT_RELAY_SECRET; the relay's OVERHEARD_TOKEN). */
  relaySecret?: string;
  /** Running revision, shown in reports (Cloud Run sets K_REVISION). */
  appVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const REPORTS_PER_IP = 5;
const REPORT_WINDOW_MS = 10 * 60_000;
// The relay opens an issue and sends an email before it answers; Apps Script can be slow to start.
const DELIVERY_TIMEOUT_MS = 25_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function reportOptionsFromEnv(env: NodeJS.ProcessEnv): ReportRouteOptions {
  return {
    relayUrl: env.REPORT_RELAY_URL?.trim() || undefined,
    relaySecret: env.REPORT_RELAY_SECRET?.trim() || undefined,
    appVersion: env.K_REVISION?.trim() || 'dev',
  };
}

interface Delivery {
  issueUrl: string | null;
  issueNumber: number | null;
  emailed: boolean;
}

/** The request body the shared relay expects (see docs/REPORTS.md). Only `email` carries private details. */
export function relayRequest(report: ProblemReport, token: string) {
  return {
    app: REPORT_APP_NAME,
    kind: 'problem-report',
    token,
    issue: { title: publicIssueTitle(report), body: publicIssueBody(report), labels: [REPORT_LABEL] },
    email: {
      subject: privateEmailSubject(report),
      body: reportAsText(report),
      ...(EMAIL_RE.test(report.contact) ? { replyTo: report.contact } : {}),
    },
  };
}

async function deliver(
  report: ProblemReport,
  { relayUrl, relaySecret }: ReportRouteOptions,
  fetchImpl: typeof fetch
): Promise<Delivery> {
  const response = await fetchImpl(relayUrl!, {
    method: 'POST',
    // Apps Script reads the raw body; text/plain keeps it a "simple" request.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(relayRequest(report, relaySecret!)),
    // Apps Script answers a POST with a redirect to the result.
    redirect: 'follow',
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Relay answered HTTP ${response.status}`);
  const data = (await response.json().catch(() => null)) as {
    ok?: unknown;
    error?: unknown;
    issue?: unknown;
    url?: unknown;
    emailed?: unknown;
  } | null;
  if (data?.ok !== true) throw new Error(`Relay refused the report: ${String(data?.error ?? 'no answer')}`);
  return {
    issueUrl: typeof data.url === 'string' ? data.url : null,
    issueNumber: typeof data.issue === 'number' ? data.issue : null,
    emailed: data.emailed === true,
  };
}

export function registerReportRoutes(app: Express, options: ReportRouteOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = createRateLimiter(REPORTS_PER_IP, REPORT_WINDOW_MS, options.now);
  const timer = setInterval(() => limiter.prune(), REPORT_WINDOW_MS);
  timer.unref?.();
  const configured = Boolean(options.relayUrl && options.relaySecret);

  // Tells the form whether sending is set up, so it can say so before anyone types anything.
  app.get('/api/report/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ automatic: configured, appVersion: options.appVersion });
  });

  app.post('/api/report', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
    if (limiter.isLimited(req.ip ?? 'unknown')) {
      res.status(429).json({ ok: false, reason: 'rate-limited' });
      return;
    }
    if (req.body?.consent !== true) {
      res.status(400).json({ ok: false, reason: 'no-consent' });
      return;
    }
    const report = normalizeReport(req.body);
    if (!report) {
      res.status(400).json({ ok: false, reason: 'invalid' });
      return;
    }
    // The server knows which revision is really running; don't rely on the page for that.
    report.diagnostics.appVersion = options.appVersion;

    if (!configured) {
      res.status(503).json({ ok: false, reason: 'not-configured' });
      return;
    }

    let delivery: Delivery | null = null;
    try {
      delivery = await deliver(report, options, fetchImpl);
    } catch (error) {
      console.error('[report] relay failed:', error instanceof Error ? error.message : error);
    }
    // Only the outcome is logged, never what the report says.
    console.log(
      '[report]',
      JSON.stringify({
        category: report.category,
        issue: delivery?.issueNumber ?? null,
        emailed: delivery?.emailed ?? false,
      })
    );

    if (!delivery) {
      res.status(502).json({ ok: false, reason: 'delivery-failed' });
      return;
    }
    res.json({ ok: true, ...delivery });
  });

  return () => clearInterval(timer);
}
