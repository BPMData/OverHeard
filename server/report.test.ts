import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';
import type { ReportRouteOptions } from './report.ts';
import { reportOptionsFromEnv } from './report.ts';

let server: Server | undefined;
let close: (() => void) | undefined;

async function start(report: Partial<ReportRouteOptions>) {
  const service = createApp({
    trustProxyHops: 1,
    mt: { ipLimitMultiplier: 10, mtPerSession: 3, cloudDailyChars: 0, mtChain: ['gtx'], shortLinkBase: null },
    report: { appVersion: 'overheard-00042', ...report },
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

const RELAY = { relayUrl: 'https://relay.example/exec', relaySecret: 'shh' };
const DELIVERED = { ok: true, issue: 90, url: 'https://github.com/BPMData/OverHeard/issues/90', emailed: true };

describe('problem report route', () => {
  it('reads its settings from the environment and treats blanks as unset', () => {
    expect(reportOptionsFromEnv({ REPORT_RELAY_URL: ' ', K_REVISION: 'rev-1' })).toEqual({
      relayUrl: undefined,
      relaySecret: undefined,
      appVersion: 'rev-1',
    });
    expect(reportOptionsFromEnv({ REPORT_RELAY_URL: ' https://r/exec ', REPORT_RELAY_SECRET: 's' })).toEqual({
      relayUrl: 'https://r/exec',
      relaySecret: 's',
      appVersion: 'dev',
    });
  });

  it('says automatic sending is set up only with both the relay URL and its secret', async () => {
    let url = await start({});
    expect(await (await fetch(`${url}/status`)).json()).toEqual({ automatic: false, appVersion: 'overheard-00042' });
    await afterEachClose();
    url = await start({ relayUrl: 'https://relay.example/exec' });
    expect((await (await fetch(`${url}/status`)).json()).automatic).toBe(false);
    await afterEachClose();
    url = await start(RELAY);
    expect((await (await fetch(`${url}/status`)).json()).automatic).toBe(true);
  });

  it('refuses a report without explicit consent or with an unknown category', async () => {
    const fetchImpl = vi.fn();
    const url = await start({ ...RELAY, fetchImpl });
    expect((await post(url, { ...REPORT, consent: undefined })).status).toBe(400);
    expect((await post(url, { ...REPORT, consent: 'yes' })).status).toBe(400);
    expect((await post(url, { ...REPORT, category: 'nope' })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers not-configured without the relay URL and secret', async () => {
    const fetchImpl = vi.fn();
    const url = await start({ relaySecret: 'shh', fetchImpl });
    const response = await post(url, REPORT);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: 'not-configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the shared relay a public issue without private details and a private email', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(DELIVERED));
    const url = await start({ ...RELAY, fetchImpl });

    const response = await post(url, REPORT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      issueUrl: 'https://github.com/BPMData/OverHeard/issues/90',
      issueNumber: 90,
      emailed: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [relayUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(relayUrl).toBe('https://relay.example/exec');
    expect(init.redirect).toBe('follow');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8');
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent).sort()).toEqual(['app', 'email', 'issue', 'kind', 'token']);
    expect(sent).toMatchObject({ app: 'OverHeard', kind: 'problem-report', token: 'shh' });

    expect(sent.issue.labels).toEqual(['user-report']);
    const published = JSON.stringify(sent.issue);
    expect(published).toContain('Spanish stopped translating');
    expect(published).toContain('[email removed]');
    expect(published).not.toContain('teacher@example.org');
    expect(published).not.toContain('Private note');
    expect(published).not.toContain('should never be kept');
    expect(published).not.toContain('shh');
    // The server's own revision replaces whatever the page claimed
    expect(published).toContain('App version: overheard-00042');
    expect(published).not.toContain('fake');

    expect(sent.email.subject).toBe('[OverHeard] Problem report: Translation');
    expect(sent.email.replyTo).toBe('teacher@example.org');
    expect(sent.email.body).toContain('Private note for Bryan');
    expect(sent.email.body).toContain('teacher@example.org');
  });

  it('leaves replyTo out when the contact is not an email address', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(DELIVERED));
    const url = await start({ ...RELAY, fetchImpl });
    expect((await post(url, { ...REPORT, contact: 'call room 12' })).status).toBe(200);
    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.email).not.toHaveProperty('replyTo');
  });

  it('passes on a partial delivery: issue filed but email not sent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json({ ...DELIVERED, emailed: false }));
    const url = await start({ ...RELAY, fetchImpl });
    expect(await (await post(url, REPORT)).json()).toEqual({
      ok: true,
      issueUrl: 'https://github.com/BPMData/OverHeard/issues/90',
      issueNumber: 90,
      emailed: false,
    });
  });

  it('fails when the relay refuses, errors, or answers with a page instead of JSON', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const answer of [
      () => json({ ok: false, error: 'not allowed' }),
      () => json({ ok: false }, 500),
      () => new Response('<html>Sign in</html>', { status: 200 }),
    ]) {
      const url = await start({ ...RELAY, fetchImpl: vi.fn(async () => answer()) });
      const response = await post(url, REPORT);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ ok: false, reason: 'delivery-failed' });
      await afterEachClose();
    }
    // Nothing the reporter wrote reaches the logs
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Spanish');
  });

  it('limits how many reports one address can send', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(DELIVERED));
    const url = await start({ ...RELAY, fetchImpl });
    for (let i = 0; i < 5; i++) expect((await post(url, REPORT)).status).toBe(200);
    expect((await post(url, REPORT)).status).toBe(429);
  });

  it('accepts a long report written in another script', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(DELIVERED));
    const url = await start({ ...RELAY, fetchImpl });
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
