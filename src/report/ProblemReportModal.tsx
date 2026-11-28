import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Globe,
  Lock,
  Mail,
  MessageSquareWarning,
  X,
} from 'lucide-react';
import { useModalDismiss } from '../components/useModalDismiss';
import { collectDiagnostics, getReportContext } from './diagnostics';
import {
  DIAGNOSTIC_FIELDS,
  MAX_CONTACT,
  MAX_TEXT,
  privateEmailSubject,
  publicIssueTitle,
  REPORT_CATEGORIES,
  REPORT_INBOX,
  reportAsText,
  scrubPublicText,
  type Diagnostics,
  type ProblemReport,
} from './protocol';

const OPEN_EVENT = 'overheard:open-problem-report';

/**
 * Open the "Something not working?" form from anywhere on the page. From inside another modal,
 * close that one first and pass `afterModalClose`: closing a modal steps browser history back,
 * and the form waits for that so the step doesn't close it straight away.
 */
export function openProblemReport(options: { afterModalClose?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: options }));
}

/** Mount once per page. Opens the form when anything calls openProblemReport(). */
export function ProblemReportHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelWait: (() => void) | null = null;
    const onOpen = (event: Event) => {
      cancelWait?.();
      const afterModalClose = (event as CustomEvent<{ afterModalClose?: boolean }>).detail?.afterModalClose;
      if (!afterModalClose) {
        setOpen(true);
        return;
      }
      const show = () => {
        cancelWait?.();
        setOpen(true);
      };
      const timer = window.setTimeout(show, 400);
      window.addEventListener('popstate', show, { once: true });
      cancelWait = () => {
        window.clearTimeout(timer);
        window.removeEventListener('popstate', show);
        cancelWait = null;
      };
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      cancelWait?.();
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  return open ? <ProblemReportModal onClose={() => setOpen(false)} /> : null;
}

type Step = 'category' | 'details' | 'private' | 'review' | 'result';
type Outcome =
  | { kind: 'sent'; issueUrl: string | null; emailed: boolean }
  | { kind: 'failed'; why: 'offline' | 'not-configured' | 'rate-limited' | 'error' };

interface ServerStatus {
  automatic: boolean;
  appVersion: string;
}

const STEP_TITLES: Record<Exclude<Step, 'result'>, string> = {
  category: 'What went wrong?',
  details: 'What happened?',
  private: 'Anything private to add?',
  review: 'Check before sending',
};
const STEP_ORDER: Array<Exclude<Step, 'result'>> = ['category', 'details', 'private', 'review'];

const fieldClass =
  'w-full rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-white dark:bg-[#0B1120] px-3 py-2 text-sm text-slate-900 dark:text-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5843A5] dark:focus-visible:ring-[#A78BFA]';
const secondaryButton =
  'oh-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] disabled:opacity-50 transition-colors';
const primaryButton =
  'oh-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-[2px] text-xs font-semibold border border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white disabled:opacity-50 transition-colors';

function downloadText(text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `overheard-problem-report-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mailtoLink(report: ProblemReport, text: string): string {
  const subject = `subject=${encodeURIComponent(privateEmailSubject(report))}`;
  const body = encodeURIComponent(text);
  // Long mailto links get cut off or refused by some mail apps; Copy covers those.
  return `mailto:${REPORT_INBOX}?${subject}${body.length < 1800 ? `&body=${body}` : ''}`;
}

/** Copy, Download and an email link: the way to send a report when automatic sending can't. */
function ManualSend({ report, text, intro }: { report: ProblemReport; text: string; intro: string }) {
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <div className="space-y-2.5">
      <p>{intro}</p>
      <p>
        Copy or download the report, then email it to{' '}
        <strong className="font-semibold select-all">{REPORT_INBOX}</strong>.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyStatus('Copied. Paste it into an email.');
            } catch {
              setCopyStatus('Couldn’t copy here. Use Download instead.');
            }
          }}
        >
          <ClipboardCopy className="w-3.5 h-3.5" aria-hidden="true" /> Copy report
        </button>
        <button type="button" className={secondaryButton} onClick={() => downloadText(text)}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download report
        </button>
        <a className={secondaryButton} href={mailtoLink(report, text)}>
          <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Open an email
        </a>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-slate-600 dark:text-[#94A3B8] min-h-[1rem]">
        {copyStatus}
      </p>
    </div>
  );
}

interface ProblemReportModalProps {
  onClose: () => void;
  fetchImpl?: typeof fetch;
}

export function ProblemReportModal({ onClose, fetchImpl = (...args) => fetch(...args) }: ProblemReportModalProps) {
  const onBackdropClick = useModalDismiss(true, onClose);
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState('');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [comments, setComments] = useState('');
  const [contact, setContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dark] = useState(() => getReportContext().isDark ?? document.documentElement.classList.contains('dark'));

  // Is automatic sending set up, and which version is running?
  useEffect(() => {
    let cancelled = false;
    fetchImpl('/api/report/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Partial<ServerStatus>) => {
        if (!cancelled)
          setServer({ automatic: data.automatic === true, appVersion: String(data.appVersion ?? 'unknown') });
      })
      .catch(() => {
        if (!cancelled) setServer({ automatic: false, appVersion: 'unknown' });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    void collectDiagnostics(server.appVersion).then((d) => {
      if (!cancelled) setDiagnostics(d);
    });
    return () => {
      cancelled = true;
    };
  }, [server]);

  // Move focus to each step's heading so screen readers announce it
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Keys typed here belong to the form: don't let Space start or stop listening, or Shift switch
  // speakers, behind it. Escape still reaches the close handler.
  useEffect(() => {
    const node = overlayRef.current;
    if (!node) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') event.stopPropagation();
    };
    node.addEventListener('keydown', stop);
    return () => node.removeEventListener('keydown', stop);
  }, []);

  const report: ProblemReport = { category, summary, steps, diagnostics, comments, contact };
  const fullText = reportAsText(report, outcome?.kind === 'sent' ? (outcome.issueUrl ?? undefined) : undefined);
  const hasPrivate = Boolean(comments.trim() || contact.trim());
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const canSendAutomatically = Boolean(server?.automatic) && online;

  const send = async () => {
    if (!confirmed || sending) return;
    if (!online) {
      setOutcome({ kind: 'failed', why: 'offline' });
      setStep('result');
      return;
    }
    setSending(true);
    try {
      const response = await fetchImpl('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...report, consent: true }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        issueUrl?: string | null;
        emailed?: boolean;
        reason?: string;
      };
      if (response.ok && data.ok) {
        setOutcome({ kind: 'sent', issueUrl: data.issueUrl ?? null, emailed: data.emailed === true });
      } else {
        const why =
          data.reason === 'not-configured' ? 'not-configured' : response.status === 429 ? 'rate-limited' : 'error';
        setOutcome({ kind: 'failed', why });
      }
    } catch {
      setOutcome({ kind: 'failed', why: navigator.onLine === false ? 'offline' : 'error' });
    } finally {
      setSending(false);
      setStep('result');
    }
  };

  const stepIndex = step === 'result' ? STEP_ORDER.length : STEP_ORDER.indexOf(step);
  const goBack = () => setStep(STEP_ORDER[Math.max(0, stepIndex - 1)]);
  const goNext = () => setStep(STEP_ORDER[Math.min(STEP_ORDER.length - 1, stepIndex + 1)]);

  const publicSummary = scrubPublicText(summary.trim());
  const publicSteps = scrubPublicText(steps.trim());

  let body: ReactNode;
  let footer: ReactNode;
  if (step === 'category') {
    body = (
      <fieldset className="space-y-2">
        <legend className="sr-only">What went wrong?</legend>
        <p className="text-slate-600 dark:text-[#94A3B8]">
          Pick the closest one. Nothing is sent until you check it at the end.
        </p>
        {REPORT_CATEGORIES.map((c) => (
          <label
            key={c.id}
            className={`flex items-start gap-3 p-3 rounded-[3px] border cursor-pointer ${
              category === c.id
                ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#EDE9FE] dark:bg-[#2E2356]'
                : 'border-[#CBD5E1] dark:border-[#243044] bg-[#F8FAFC] dark:bg-[#0B1120]'
            }`}
          >
            <input
              type="radio"
              name="problem-category"
              value={c.id}
              checked={category === c.id}
              onChange={() => setCategory(c.id)}
              className="mt-1 accent-[#5843A5]"
            />
            <span>
              <span className="block font-semibold text-slate-900 dark:text-[#F8FAFC]">{c.label}</span>
              <span className="block text-xs text-slate-600 dark:text-[#94A3B8]">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    );
    footer = (
      <button type="button" className={primaryButton} disabled={!category} onClick={goNext}>
        Next
      </button>
    );
  } else if (step === 'details') {
    body = (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-slate-600 dark:text-[#94A3B8]">
          <Globe className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            These answers will be <strong className="text-slate-900 dark:text-white">public</strong> on GitHub. Skip
            anything you don’t know. Don’t write student names, room codes or PINs.
          </span>
        </p>
        <label className="block space-y-1">
          <span className="font-semibold">What happened? (optional)</span>
          <textarea
            className={fieldClass}
            rows={3}
            maxLength={MAX_TEXT}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Example: Spanish captions stopped after a few minutes."
          />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">How can we make it happen again? (optional)</span>
          <textarea
            className={fieldClass}
            rows={3}
            maxLength={MAX_TEXT}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder="Example: Choose Spanish, press Start Listening, talk for 5 minutes."
          />
        </label>
      </div>
    );
    footer = (
      <>
        <button type="button" className={secondaryButton} onClick={goBack}>
          Back
        </button>
        <button type="button" className={primaryButton} onClick={goNext}>
          {summary.trim() || steps.trim() ? 'Next' : 'Skip'}
        </button>
      </>
    );
  } else if (step === 'private') {
    body = (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-slate-600 dark:text-[#94A3B8]">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            These are <strong className="text-slate-900 dark:text-white">private</strong>. They go only to the OverHeard
            maintainer by email, never to GitHub.
          </span>
        </p>
        <label className="block space-y-1">
          <span className="font-semibold">Other comments (optional)</span>
          <textarea
            className={fieldClass}
            rows={3}
            maxLength={MAX_TEXT}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Your email, if you want to hear when it’s fixed (optional)</span>
          <input
            type="email"
            className={fieldClass}
            maxLength={MAX_CONTACT}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            autoComplete="email"
          />
        </label>
      </div>
    );
    footer = (
      <>
        <button type="button" className={secondaryButton} onClick={goBack}>
          Back
        </button>
        <button type="button" className={primaryButton} onClick={goNext}>
          {hasPrivate ? 'Next' : 'Skip'}
        </button>
      </>
    );
  } else if (step === 'review') {
    const diagnosticRows = DIAGNOSTIC_FIELDS.filter(({ key }) => diagnostics[key]);
    body = (
      <div className="space-y-4">
        <section
          aria-labelledby="report-public-heading"
          className="p-3 rounded-[3px] border border-[#CBD5E1] dark:border-[#243044] bg-[#F8FAFC] dark:bg-[#0B1120] space-y-2"
        >
          <h3 id="report-public-heading" className="flex items-center gap-2 font-bold">
            <Globe className="w-4 h-4" aria-hidden="true" /> Public on GitHub: anyone can see this
          </h3>
          <dl className="space-y-1.5 text-xs sm:text-sm">
            <div>
              <dt className="font-semibold">Title</dt>
              <dd>{publicIssueTitle(report)}</dd>
            </div>
            <div>
              <dt className="font-semibold">What happened</dt>
              <dd className="whitespace-pre-wrap">{publicSummary || 'Not given.'}</dd>
            </div>
            <div>
              <dt className="font-semibold">How to make it happen again</dt>
              <dd className="whitespace-pre-wrap">{publicSteps || 'Not given.'}</dd>
            </div>
            <div>
              <dt className="font-semibold">Diagnostics</dt>
              <dd>
                <ul className="list-disc list-inside">
                  {diagnosticRows.map(({ key, label }) => (
                    <li key={key}>
                      {label}: {diagnostics[key]}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-600 dark:text-[#94A3B8]">
            Never included: audio, captions, translations, student information, room codes, PINs or saved lessons.
          </p>
        </section>
        <section
          aria-labelledby="report-private-heading"
          className="p-3 rounded-[3px] border border-[#CBD5E1] dark:border-[#243044] bg-[#F8FAFC] dark:bg-[#0B1120] space-y-2"
        >
          <h3 id="report-private-heading" className="flex items-center gap-2 font-bold">
            <Lock className="w-4 h-4" aria-hidden="true" /> Private: emailed only to the maintainer
          </h3>
          <dl className="space-y-1.5 text-xs sm:text-sm">
            <div>
              <dt className="font-semibold">Other comments</dt>
              <dd className="whitespace-pre-wrap">{comments.trim() || 'None.'}</dd>
            </div>
            <div>
              <dt className="font-semibold">Your email</dt>
              <dd>{contact.trim() || 'None.'}</dd>
            </div>
          </dl>
        </section>
        {canSendAutomatically ? (
          <label className="flex items-start gap-2 font-semibold">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 accent-[#5843A5]"
            />
            <span>I checked this. Send it.</span>
          </label>
        ) : (
          server && (
            <ManualSend
              report={report}
              text={fullText}
              intro={
                online
                  ? 'Automatic sending isn’t set up on this server yet.'
                  : 'You’re offline, so this can’t be sent right now.'
              }
            />
          )
        )}
      </div>
    );
    footer = (
      <>
        <button type="button" className={secondaryButton} onClick={goBack}>
          Back
        </button>
        {canSendAutomatically && (
          <button type="button" className={primaryButton} disabled={!confirmed || sending} onClick={send}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
        )}
        {!server && (
          <span role="status" className="text-xs">
            Checking…
          </span>
        )}
      </>
    );
  } else {
    if (outcome?.kind === 'sent') {
      body = (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> Thank you. Your report was sent.
          </p>
          {outcome.issueUrl && (
            <p>
              <a
                href={outcome.issueUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline font-semibold"
              >
                See it on GitHub <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </p>
          )}
          {!outcome.emailed && hasPrivate && (
            <ManualSend report={report} text={fullText} intro="Your private comments or email didn’t go through." />
          )}
        </div>
      );
    } else {
      const intro =
        outcome?.why === 'offline'
          ? 'You’re offline, so the report wasn’t sent.'
          : outcome?.why === 'not-configured'
            ? 'Automatic sending isn’t set up on this server yet.'
            : outcome?.why === 'rate-limited'
              ? 'Too many reports were sent from here just now.'
              : 'The report couldn’t be sent.';
      body = (
        <div role="alert">
          <ManualSend report={report} text={fullText} intro={intro} />
        </div>
      );
    }
    footer = (
      <button type="button" className={primaryButton} onClick={onClose}>
        Close
      </button>
    );
  }

  const title =
    step === 'result' ? (outcome?.kind === 'sent' ? 'Report sent' : 'Send it another way') : STEP_TITLES[step];

  const modal = (
    <div ref={overlayRef} className={dark ? 'dark' : ''}>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-report-title"
        onClick={onBackdropClick}
      >
        <div className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-[3px] border-2 border-[#94A3B8] dark:border-[#334155] bg-white dark:bg-[#111827] text-slate-900 dark:text-[#F8FAFC] overflow-hidden">
          <div className="oh-panel-header flex items-center justify-between px-5 py-3.5 border-b border-[#CBD5E1] dark:border-[#243044] bg-[#F1F5F9] dark:bg-[#162033] shrink-0">
            <div className="flex items-center gap-2.5">
              <MessageSquareWarning className="w-5 h-5 text-[#5843A5] dark:text-[#A78BFA]" aria-hidden="true" />
              <div>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  Something not working?{step !== 'result' && ` Step ${stepIndex + 1} of ${STEP_ORDER.length}`}
                </p>
                <h2
                  id="problem-report-title"
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-base sm:text-lg font-bold tracking-tight focus:outline-none"
                >
                  {title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="oh-btn p-1.5 rounded-[2px] border border-transparent hover:border-[#CBD5E1] dark:hover:border-[#2B3952] text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-white"
              aria-label="Close problem report"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-4 text-sm leading-relaxed overflow-y-auto">{body}</div>
          <div className="px-5 py-3 border-t border-[#CBD5E1] dark:border-[#243044] bg-[#F1F5F9] dark:bg-[#0B1120] flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
