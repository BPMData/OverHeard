// Problem reports: the shape a report takes and how it is turned into a public GitHub issue and a
// private email. Shared by the browser (to preview exactly what will be sent) and the server (to
// build what is actually sent), so the two can never disagree. Keep this module free of imports
// and strictly erasable TypeScript: the production server imports it under Node type stripping.

/** Every report goes to this shared inbox (the same one OverBoard uses). */
export const REPORT_INBOX = 'overboard.reporting@gmail.com';
export const REPORT_APP_NAME = 'OverHeard';
export const REPORT_LABEL = 'user-report';

export const MAX_TEXT = 2000;
export const MAX_CONTACT = 200;
const MAX_DIAGNOSTIC_VALUE = 120;
const MAX_TITLE_SUMMARY = 60;

export interface ReportCategory {
  id: string;
  label: string;
  hint: string;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { id: 'mic-captions', label: 'Microphone or captions', hint: 'Listening won’t start, stops, or captions are wrong or missing.' },
  { id: 'translation', label: 'Translation', hint: 'A language doesn’t translate, is slow, or says it needs the internet.' },
  { id: 'read-aloud', label: 'Read-aloud voices', hint: 'A voice won’t download, play, or sounds wrong.' },
  { id: 'conversation-lecture', label: 'Two-way or Lecture', hint: 'Speaker switching, the lecture transcript, or saving it.' },
  { id: 'student-room', label: 'Student rooms', hint: 'Students can’t join, or captions don’t reach their devices.' },
  { id: 'popout-display', label: 'Pop-out or display', hint: 'The floating caption window, text size, or dark mode.' },
  { id: 'other', label: 'Something else', hint: 'Anything that doesn’t fit above.' },
];

/**
 * The only diagnostics a report may carry, in display order. Each one is a feature or permission
 * status. Never add anything that could hold speech, transcripts, translations, student
 * information, room codes, PINs or lesson content.
 */
export const DIAGNOSTIC_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'appVersion', label: 'App version' },
  { key: 'browser', label: 'Browser' },
  { key: 'os', label: 'Operating system' },
  { key: 'page', label: 'Page' },
  { key: 'view', label: 'View' },
  { key: 'listening', label: 'Listening' },
  { key: 'speechRecognition', label: 'Speech recognition available' },
  { key: 'microphone', label: 'Microphone permission' },
  { key: 'translator', label: 'Translator setting' },
  { key: 'lastTranslator', label: 'Last translator used' },
  { key: 'onDeviceTranslation', label: 'On-device translation available' },
  { key: 'languages', label: 'Caption languages' },
  { key: 'popOut', label: 'Pop-out captions available' },
  { key: 'online', label: 'Online' },
];

export type Diagnostics = Record<string, string>;

export interface ProblemReport {
  category: string;
  /** What happened. Public. */
  summary: string;
  /** How to make it happen again. Public. */
  steps: string;
  diagnostics: Diagnostics;
  /** Anything else the reporter wants to say. Private: email only. */
  comments: string;
  /** Optional email or name for a reply. Private: email only. */
  contact: string;
}

export function categoryLabel(id: string): string {
  return REPORT_CATEGORIES.find((c) => c.id === id)?.label ?? 'Something else';
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

/**
 * Check and tidy a report that arrived from a browser. Returns null when it can't be used.
 * Unknown diagnostic keys are dropped, so nothing outside the list above can reach an issue.
 */
export function normalizeReport(input: unknown): ProblemReport | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.category !== 'string' || !REPORT_CATEGORIES.some((c) => c.id === raw.category)) return null;
  const diagnostics: Diagnostics = {};
  const rawDiagnostics = raw.diagnostics && typeof raw.diagnostics === 'object'
    ? raw.diagnostics as Record<string, unknown> : {};
  for (const { key } of DIAGNOSTIC_FIELDS) {
    const value = clip(rawDiagnostics[key], MAX_DIAGNOSTIC_VALUE).replace(/\s+/g, ' ');
    if (value) diagnostics[key] = value;
  }
  return {
    category: raw.category,
    summary: clip(raw.summary, MAX_TEXT),
    steps: clip(raw.steps, MAX_TEXT),
    diagnostics,
    comments: clip(raw.comments, MAX_TEXT),
    contact: clip(raw.contact, MAX_CONTACT),
  };
}

/**
 * Remove things that should never be published from text that will be public: email addresses
 * and long numbers such as phone numbers. The reporter is also asked not to include names,
 * room codes or PINs; this is a backstop, not a guarantee.
 */
export function scrubPublicText(text: string): string {
  return text
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[email removed]')
    // Phone-like runs of 9+ digits. Dots aren't separators here, so version numbers survive,
    // and dates (8 digits) do too.
    .replace(/(?:\+|\()?\d[\d\s()-]{7,}\d/g, (match) =>
      (match.match(/\d/g)?.length ?? 0) >= 9 ? '[number removed]' : match);
}

/** Text inside a fenced block can't ping people, embed images or break the issue's layout. */
function fenced(text: string): string {
  return `~~~text\n${text.replace(/~{3,}/g, '~~')}\n~~~`;
}

function diagnosticLines(diagnostics: Diagnostics): string[] {
  return DIAGNOSTIC_FIELDS.filter(({ key }) => diagnostics[key]).map(
    ({ key, label }) => `${label}: ${diagnostics[key]}`,
  );
}

export function publicIssueTitle(report: ProblemReport): string {
  const summary = scrubPublicText(report.summary).replace(/\s+/g, ' ').trim();
  const short = summary.length > MAX_TITLE_SUMMARY ? `${summary.slice(0, MAX_TITLE_SUMMARY - 1)}…` : summary;
  return `[User report] ${categoryLabel(report.category)}${short ? `: ${short}` : ''}`;
}

/** The public GitHub issue body. Never includes the contact details or private comments. */
export function publicIssueBody(report: ProblemReport): string {
  const parts = [
    `Reported from inside ${REPORT_APP_NAME} with the “Something not working?” form.`,
    '',
    `**What went wrong:** ${categoryLabel(report.category)}`,
    '',
    '**What happened**',
    report.summary ? fenced(scrubPublicText(report.summary)) : '_Not given._',
    '',
    '**How to make it happen again**',
    report.steps ? fenced(scrubPublicText(report.steps)) : '_Not given._',
    '',
    '**Diagnostics**',
    fenced(diagnosticLines(report.diagnostics).join('\n') || 'None'),
    '',
    `_Any contact details or private comments went only to the maintainer by email._`,
  ];
  return parts.join('\n');
}

export function privateEmailSubject(report: ProblemReport): string {
  return `[${REPORT_APP_NAME}] Problem report: ${categoryLabel(report.category)}`;
}

/** The full report as plain text: what the email says, and what Copy and Download give. */
export function reportAsText(report: ProblemReport, issueUrl?: string): string {
  const lines = [
    `${REPORT_APP_NAME} problem report`,
    '',
    `What went wrong: ${categoryLabel(report.category)}`,
    '',
    'What happened (public):',
    report.summary || 'Not given.',
    '',
    'How to make it happen again (public):',
    report.steps || 'Not given.',
    '',
    'Diagnostics (public):',
    ...(diagnosticLines(report.diagnostics).length ? diagnosticLines(report.diagnostics) : ['None']),
    '',
    'Other comments (private):',
    report.comments || 'None.',
    '',
    'Contact (private):',
    report.contact || 'None.',
  ];
  if (issueUrl) lines.push('', `GitHub issue: ${issueUrl}`);
  return lines.join('\n');
}
