// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProblemReport, ProblemReportHost, ProblemReportModal } from './ProblemReportModal';
import { resetReportContext, setReportContext } from './diagnostics';
import { REPORT_INBOX } from './protocol';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Answer = Response | (() => Response | Promise<Response>);

function mockServer({ automatic = true, report }: { automatic?: boolean; report?: Answer } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url) === '/api/report/status') return json({ automatic, appVersion: 'overheard-00042' });
    if (typeof report === 'function') return report();
    return (
      report ??
      json({ ok: true, issueUrl: 'https://github.com/BPMData/overheard/issues/90', issueNumber: 90, emailed: true })
    );
  });
}

let onLine = true;
beforeEach(() => {
  onLine = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
  resetReportContext();
  setReportContext({ page: 'Main', view: 'Columns', listening: true, languages: ['es', 'pt'], translator: 'auto' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Skip)$/ }));

async function fillAndReview({ summary = '', comments = '', contact = '' } = {}) {
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Translation/));
  next();
  if (summary) fireEvent.change(screen.getByLabelText(/What happened\? \(optional\)/), { target: { value: summary } });
  next();
  if (comments) fireEvent.change(screen.getByLabelText(/Other comments/), { target: { value: comments } });
  if (contact) fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: contact } });
  next();
  await screen.findByRole('heading', { name: 'Check before sending' });
}

describe('ProblemReportModal', () => {
  it('walks through short steps, lets every detail be skipped, and sends only after confirmation', async () => {
    const fetchImpl = mockServer();
    render(<ProblemReportModal onClose={() => {}} fetchImpl={fetchImpl} />);
    expect(screen.getByRole('heading', { name: 'What went wrong?' })).toBeTruthy();
    expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();

    await fillAndReview();
    const send = await screen.findByRole('button', { name: 'Send report' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the status check

    fireEvent.click(screen.getByLabelText(/I checked this/));
    fireEvent.click(send);
    await screen.findByText(/Your report was sent/);
    const link = screen.getByRole('link', { name: /See it on GitHub/ });
    expect(link.getAttribute('href')).toBe('https://github.com/BPMData/overheard/issues/90');

    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/report');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ consent: true, category: 'translation', summary: '', steps: '' });
  });

  it('shows exactly what will be public and keeps private fields apart', async () => {
    render(<ProblemReportModal onClose={() => {}} fetchImpl={mockServer()} />);
    await fillAndReview({
      summary: 'Stopped. Write me at me@school.org',
      comments: 'My period 3 class',
      contact: 'me@school.org',
    });

    const publicPart = screen.getByRole('region', { name: /Public on GitHub/ });
    const privatePart = screen.getByRole('region', { name: /Private/ });
    expect(within(publicPart).getByText('Stopped. Write me at [email removed]')).toBeTruthy();
    expect(within(publicPart).queryByText(/period 3/)).toBeNull();
    expect(within(publicPart).queryByText(/me@school.org/)).toBeNull();
    expect(within(privatePart).getByText('My period 3 class')).toBeTruthy();
    expect(within(privatePart).getByText('me@school.org')).toBeTruthy();

    // Diagnostics: feature status only, with the server's version
    await within(publicPart).findByText('App version: overheard-00042');
    expect(within(publicPart).getByText('Caption languages: es, pt')).toBeTruthy();
    expect(within(publicPart).getByText('Listening: yes')).toBeTruthy();
    expect(within(publicPart).getByText(/Never included: audio, captions, translations/)).toBeTruthy();
  });

  it('offers copy, download and the shared inbox when automatic sending is not set up', async () => {
    const fetchImpl = mockServer({ automatic: false });
    render(<ProblemReportModal onClose={() => {}} fetchImpl={fetchImpl} />);
    await fillAndReview({ comments: 'private' });
    await screen.findByText(/Automatic sending isn’t set up/);
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
    expect(screen.getByText(REPORT_INBOX)).toBeTruthy();
    const email = screen.getByRole('link', { name: /Open an email/ });
    expect(email.getAttribute('href')).toMatch(/^mailto:overboard\.reporting@gmail\.com\?subject=%5BOverHeard%5D/);
    expect(decodeURIComponent(email.getAttribute('href')!)).toContain('private');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: /Copy report/ }));
    await screen.findByText(/Copied/);
    expect(writeText.mock.calls[0][0]).toContain('OverHeard problem report');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to sending it another way when the server fails', async () => {
    render(
      <ProblemReportModal
        onClose={() => {}}
        fetchImpl={mockServer({ report: json({ ok: false, reason: 'delivery-failed' }, 502) })}
      />
    );
    await fillAndReview();
    fireEvent.click(await screen.findByLabelText(/I checked this/));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('heading', { name: 'Send it another way' });
    expect(screen.getByRole('alert').textContent).toMatch(/couldn’t be sent/);
    expect(screen.getByRole('button', { name: /Download report/ })).toBeTruthy();
  });

  it('says when private details did not reach the inbox even though the issue was filed', async () => {
    const report = json({
      ok: true,
      issueUrl: 'https://github.com/BPMData/overheard/issues/91',
      issueNumber: 91,
      emailed: false,
    });
    render(<ProblemReportModal onClose={() => {}} fetchImpl={mockServer({ report })} />);
    await fillAndReview({ contact: 'me@school.org' });
    fireEvent.click(await screen.findByLabelText(/I checked this/));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText(/Your report was sent/);
    expect(screen.getByText(/private comments or email didn’t go through/)).toBeTruthy();
  });

  it('does not try to send while offline', async () => {
    const fetchImpl = mockServer();
    render(<ProblemReportModal onClose={() => {}} fetchImpl={fetchImpl} />);
    await fillAndReview();
    await screen.findByLabelText(/I checked this/);
    onLine = false;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    next();
    await screen.findByText(/You’re offline/);
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
  });

  it('keeps keys typed in the form away from the caption hotkeys behind it', async () => {
    const hotkey = vi.fn();
    window.addEventListener('keydown', hotkey);
    const onClose = vi.fn();
    render(<ProblemReportModal onClose={onClose} fetchImpl={mockServer()} />);
    fireEvent.keyDown(screen.getByLabelText(/Translation/), { key: ' ', code: 'Space' });
    expect(hotkey).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText(/Translation/), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    window.removeEventListener('keydown', hotkey);
  });

  it('opens from anywhere on the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockServer());
    render(<ProblemReportHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openProblemReport());
    expect(await screen.findByRole('dialog', { name: 'What went wrong?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close problem report' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
