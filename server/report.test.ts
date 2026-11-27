import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';
import type { ReportRouteOptions } from './report.ts';
import { reportOptionsFromEnv } from './report.ts';
import { REPORT_INBOX } from '../src/report/protocol.ts';

let server: Server | undefined;
let close: (() => void) | undefined;

async function start(report: Partial<ReportRouteOptions>) {
  const service = createApp({
    trustProxyHops: 1,
    mt: { ipLimitMultiplier: 10, mtPerSession: 3, cloudDailyChars: 0, mtChain: ['gtx'], shortLinkBase: null },
    report: { githubRepo: 'BPMData/overheard', appVersion: 'over-heard-00042', ...report },
  });
  close = service.close;
  await new Promise<void>((resolve, reject) => {
    server = service.app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { port } = server!.address() as { port: number };
  return `http://127.0.0.1:${port}/api/report`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  close?.();
  if (server) {
    const instance = server;
    server = undefined;
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  }
});

const REPORT = {
  consent: true,
  category: 'translation',
  summary: 'Spanish stopped translating. Email me at teacher@example.org',
  steps: 'Start listening, wait a minute',
  comments: 'Private note for Bryan',
  contact: 'teacher@example.org',
  diagnostics: { browser: 'Chrome 142', online: 'yes', transcript: 'should never be kept', appVersion: 'fake' },
};

function post(url: string, body: unknown) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('problem report route', () => {
  it('reads its settings from the environment and treats blanks as unset', () => {
    expect(reportOptionsFromEnv({ REPORT_GITHUB_TOKEN: ' ', K_REVISION: 'rev-1' })).toEqual({
      githubToken: undefined,
      githubRepo: 'BPMData/overheard',
      relayUrl: undefined,
      relaySecret: undefined,
      appVersion: 'rev-1',
    });
  });

  it('says whether automatic sending is set up', async () => {
    let url = await start({});
    expect(await (await fetch(`${url}/status`)).json()).toEqual({ automatic: false, appVersion: 'over-heard-00042' });
    await afterEachClose();
    url = await start({ relayUrl: 'https://relay.example/exec' });
    expect((await (await fetch(`${url}/status`)).json()).automatic).toBe(true);
  });

  it('refuses a report without explicit consent or with an unknown category', async () => {
    const fetchImpl = vi.fn();
    const url = await start({ githubToken: 't', fetchImpl });
    expect((await post(url, { ...REPORT, consent: undefined })).status).toBe(400);
    expect((await post(url, { ...REPORT, consent: 'yes' })).status).toBe(400);
    expect((await post(url, { ...REPORT, category: 'nope' })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers not-configured when neither delivery path is set', async () => {
    const url = await start({});
    const response = await post(url, REPORT);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('files a public issue without private details and emails the full report', async () => {
    const fetchImpl = vi.fn(async (target: string | URL | Request) =>
      String(target).startsWith('https://api.github.com')
        ? json({ html_url: 'https://github.com/BPMData/overheard/issues/90', number: 90 }, 201)
        : json({ ok: true })
    );
    const url = await start({
      githubToken: 'secret-token',
      relayUrl: 'https://relay.example/exec',
      relaySecret: 'shh',
      fetchImpl,
    });

    const response = await post(url, REPORT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      issueUrl: 'https://github.com/BPMData/overheard/issues/90',
      issueNumber: 90,
      emailed: true,
    });

    const [issueUrl, issueInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(issueUrl).toBe('https://api.github.com/repos/BPMData/overheard/issues');
    expect((issueInit.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    const issue = JSON.parse(String(issueInit.body));
    expect(issue.labels).toEqual(['user-report']);
    const published = `${issue.title}\n${issue.body}`;
    expect(published).toContain('Spanish stopped translating');
    expect(published).toContain('[email removed]');
    expect(published).not.toContain('teacher@example.org');
    expect(published).not.toContain('Private note');
    expect(published).not.toContain('should never be kept');
    // The server's own revision replaces whatever the page claimed
    expect(published).toContain('App version: over-heard-00042');
    expect(published).not.toContain('fake');

    const [relayUrl, relayInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(relayUrl).toBe('https://relay.example/exec');
    const mail = JSON.parse(String(relayInit.body));
    expect(mail).toMatchObject({ secret: 'shh', app: 'OverHeard', to: REPORT_INBOX, replyTo: 'teacher@example.org' });
    expect(mail.subject).toBe('[OverHeard] Problem report: Translation (#90)');
    expect(mail.text).toContain('Private note for Bryan');
    expect(mail.text).toContain('https://github.com/BPMData/overheard/issues/90');
  });

  it('still emails the report when GitHub fails, and fails only when both paths fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async (target: string | URL | Request) =>
      String(target).startsWith('https://api.github.com')
        ? json({ message: 'Bad credentials' }, 401)
        : json({ ok: true })
    );
    let url = await start({ githubToken: 'bad', relayUrl: 'https://relay.example/exec', fetchImpl });
    expect(await (await post(url, REPORT)).json()).toEqual({
      ok: true,
      issueUrl: null,
      issueNumber: null,
      emailed: true,
    });

    await afterEachClose();
    const failing = vi.fn(async () => json({ ok: false }, 500));
    url = await start({ githubToken: 'bad', relayUrl: 'https://relay.example/exec', fetchImpl: failing });
    const response = await post(url, REPORT);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, reason: 'delivery-failed' });
    // Nothing the reporter wrote reaches the logs
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Spanish');
  });

  it('treats a relay answer without ok: true as a failed email', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('<html>Sign in</html>', { status: 200 }));
    const url = await start({ relayUrl: 'https://relay.example/exec', fetchImpl });
    expect((await post(url, REPORT)).status).toBe(502);
  });

  it('limits how many reports one address can send', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const url = await start({ relayUrl: 'https://relay.example/exec', fetchImpl });
    for (let i = 0; i < 5; i++) expect((await post(url, REPORT)).status).toBe(200);
    expect((await post(url, REPORT)).status).toBe(429);
  });

  it('accepts a long report written in another script', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const url = await start({ relayUrl: 'https://relay.example/exec', fetchImpl });
    const long = '字'.repeat(2000);
    expect((await post(url, { ...REPORT, summary: long, steps: long, comments: long })).status).toBe(200);
  });
});

async function afterEachClose() {
  close?.();
  close = undefined;
  if (server) {
    const instance = server;
    server = undefined;
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  }
}
