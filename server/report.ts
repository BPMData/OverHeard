import express from 'express';
import type { Express, Request, Response } from 'express';
import { createRateLimiter } from './rateLimit.ts';
import {
  normalizeReport,
  privateEmailSubject,
  publicIssueBody,
  publicIssueTitle,
  REPORT_APP_NAME,
  REPORT_INBOX,
  REPORT_LABEL,
  reportAsText,
} from '../src/report/protocol.ts';
import type { ProblemReport } from '../src/report/protocol.ts';

// "Something not working?" reports. The browser never sees a credential: this server creates the
// public GitHub issue with its own token and hands the full report (with any contact details and
// private comments) to an email relay that sends it to the shared reporting inbox. Either path
// can be left unset; with neither, the form falls back to Copy/Download and a manual email.

export interface ReportRouteOptions {
  /** Fine-grained token that may create issues in `githubRepo` (REPORT_GITHUB_TOKEN). */
  githubToken?: string;
  /** owner/name of the repository that gets the issue (REPORT_GITHUB_REPO). */
  githubRepo: string;
  /** Google Apps Script web app that emails the report (REPORT_RELAY_URL). */
  relayUrl?: string;
  /** Shared secret the relay checks (REPORT_RELAY_SECRET). */
  relaySecret?: string;
  /** Running revision, shown in reports (Cloud Run sets K_REVISION). */
  appVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const REPORTS_PER_IP = 5;
const REPORT_WINDOW_MS = 10 * 60_000;
const DELIVERY_TIMEOUT_MS = 10_000;

export function reportOptionsFromEnv(env: NodeJS.ProcessEnv): ReportRouteOptions {
  return {
    githubToken: env.REPORT_GITHUB_TOKEN?.trim() || undefined,
    githubRepo: env.REPORT_GITHUB_REPO?.trim() || 'BPMData/overheard',
    relayUrl: env.REPORT_RELAY_URL?.trim() || undefined,
    relaySecret: env.REPORT_RELAY_SECRET?.trim() || undefined,
    appVersion: env.K_REVISION?.trim() || 'dev',
  };
}

interface IssueResult {
  url: string;
  number: number;
}

async function createIssue(
  report: ProblemReport,
  { githubToken, githubRepo }: ReportRouteOptions,
  fetchImpl: typeof fetch
): Promise<IssueResult> {
  const response = await fetchImpl(`https://api.github.com/repos/${githubRepo}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': `${REPORT_APP_NAME}-problem-report`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: publicIssueTitle(report),
      body: publicIssueBody(report),
      labels: [REPORT_LABEL],
    }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
  const data = (await response.json()) as { html_url?: unknown; number?: unknown };
  if (typeof data.html_url !== 'string' || typeof data.number !== 'number') {
    throw new Error('GitHub answered without an issue link');
  }
  return { url: data.html_url, number: data.number };
}

async function emailReport(
  report: ProblemReport,
  issue: IssueResult | null,
  { relayUrl, relaySecret }: ReportRouteOptions,
  fetchImpl: typeof fetch
): Promise<void> {
  const subject = issue ? `${privateEmailSubject(report)} (#${issue.number})` : privateEmailSubject(report);
  const response = await fetchImpl(relayUrl!, {
    method: 'POST',
    // Apps Script reads the raw body; text/plain keeps it a "simple" request.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: relaySecret ?? '',
      app: REPORT_APP_NAME,
      to: REPORT_INBOX,
      subject,
      text: reportAsText(report, issue?.url),
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(report.contact) ? report.contact : '',
      issueUrl: issue?.url ?? '',
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Relay answered HTTP ${response.status}`);
  const data = (await response.json().catch(() => null)) as { ok?: unknown } | null;
  if (data?.ok !== true) throw new Error('Relay did not confirm the email');
}

export function registerReportRoutes(app: Express, options: ReportRouteOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = createRateLimiter(REPORTS_PER_IP, REPORT_WINDOW_MS, options.now);
  const timer = setInterval(() => limiter.prune(), REPORT_WINDOW_MS);
  timer.unref?.();
  const canIssue = Boolean(options.githubToken);
  const canEmail = Boolean(options.relayUrl);

  // Tells the form whether sending is set up, so it can say so before anyone types anything.
  app.get('/api/report/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ automatic: canIssue || canEmail, appVersion: options.appVersion });
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

    if (!canIssue && !canEmail) {
      res.status(503).json({ ok: false, reason: 'not-configured' });
      return;
    }

    let issue: IssueResult | null = null;
    if (canIssue) {
      try {
        issue = await createIssue(report, options, fetchImpl);
      } catch (error) {
        console.error('[report] GitHub issue failed:', error instanceof Error ? error.message : error);
      }
    }
    let emailed = false;
    if (canEmail) {
      try {
        await emailReport(report, issue, options, fetchImpl);
        emailed = true;
      } catch (error) {
        console.error('[report] email relay failed:', error instanceof Error ? error.message : error);
      }
    }
    // Only the outcome is logged, never what the report says.
    console.log('[report]', JSON.stringify({ category: report.category, issue: issue?.number ?? null, emailed }));

    if (!issue && !emailed) {
      res.status(502).json({ ok: false, reason: 'delivery-failed' });
      return;
    }
    res.json({ ok: true, issueUrl: issue?.url ?? null, issueNumber: issue?.number ?? null, emailed });
  });

  return () => clearInterval(timer);
}
