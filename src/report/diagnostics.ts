import type { Diagnostics } from './protocol';

/**
 * What the page currently knows about its own state, for problem reports. Pages fill this in as
 * they change; the report form reads it when it opens. Only feature and permission status goes
 * here, never captions, translations, room codes, PINs or anything about students.
 */
export interface ReportContext {
  page?: 'Main' | 'Student room';
  view?: string;
  listening?: boolean;
  translator?: string;
  lastTranslator?: string;
  onDeviceTranslation?: boolean;
  languages?: string[];
  isDark?: boolean;
}

let context: ReportContext = {};

export function setReportContext(patch: ReportContext) {
  context = { ...context, ...patch };
}

export function getReportContext(): ReportContext {
  return context;
}

/** For tests */
export function resetReportContext() {
  context = {};
}

const yesNo = (value: boolean | undefined) => (value === undefined ? '' : value ? 'yes' : 'no');

/** Browser name and major version, from the user agent. Nothing that identifies a person. */
export function describeBrowser(ua: string): { browser: string; os: string } {
  const pick = (re: RegExp) => ua.match(re)?.[1];
  let browser = 'Unknown browser';
  const edge = pick(/Edg(?:e|A|iOS)?\/(\d+)/);
  const firefox = pick(/(?:Firefox|FxiOS)\/(\d+)/);
  const chrome = pick(/(?:Chrome|CriOS)\/(\d+)/);
  const safari = pick(/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/);
  if (edge) browser = `Edge ${edge}`;
  else if (firefox) browser = `Firefox ${firefox}`;
  else if (chrome) browser = `Chrome ${chrome}`;
  else if (safari) browser = `Safari ${safari}`;

  let os = 'Unknown';
  if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS / iPadOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

async function microphonePermission(): Promise<string> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return status?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Gather the limited diagnostics a report carries. `appVersion` comes from the server. */
export async function collectDiagnostics(appVersion: string): Promise<Diagnostics> {
  const ctx = getReportContext();
  const { browser, os } = describeBrowser(navigator.userAgent);
  const w = window as unknown as Record<string, unknown>;
  const all: Diagnostics = {
    appVersion,
    browser,
    os,
    page: ctx.page ?? '',
    view: ctx.view ?? '',
    listening: yesNo(ctx.listening),
    speechRecognition: yesNo('SpeechRecognition' in w || 'webkitSpeechRecognition' in w),
    microphone: await microphonePermission(),
    translator: ctx.translator ?? '',
    lastTranslator: ctx.lastTranslator ?? '',
    onDeviceTranslation: yesNo(ctx.onDeviceTranslation),
    languages: ctx.languages?.join(', ') ?? '',
    popOut: yesNo('documentPictureInPicture' in w),
    online: yesNo(navigator.onLine !== false),
  };
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== ''));
}
