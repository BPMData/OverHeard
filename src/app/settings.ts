import { DEFAULT_LANGUAGES, MAX_LANGUAGES, VALID_LANGUAGE_CODES } from '../constants';
import type { LanguageCode } from '../types';
import type { ServerMtProvider } from '../translation/protocol';

export function parseInitialLanguages(): LanguageCode[] {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGES;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('langs');
  if (!raw) return DEFAULT_LANGUAGES;

  const codes = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((code): code is LanguageCode => VALID_LANGUAGE_CODES.has(code));

  const unique = Array.from(new Set(codes)).slice(0, MAX_LANGUAGES);
  return unique.length > 0 ? unique : DEFAULT_LANGUAGES;
}

export function formatTimestamp(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Live translation tuning: send in-progress speech after a short pause, or every few new words
export const LIVE_INTERIM_TRANSLATION = true;
export const MT_CLIENT_CACHE_MAX = 2000;

// The explicitly selected local-only mode gives slower devices more time per sentence.
export const ON_DEVICE_TIMEOUT_MS = 10_000;
export const AUTO_ON_DEVICE_TIMEOUT_MS = 5000;
// Translations slower than this are flagged in the UI and console with how far over they went
export const SLOW_TRANSLATION_MS = 2500;

export function rejectAfter<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const mtCacheKey = (preference: string, source: string, lang: string, text: string) =>
  `${preference}\u0000${source}\u0000${lang}\u0000${text}`;

export const overBy = (ms: number) => (ms > SLOW_TRANSLATION_MS ? ` (+${ms - SLOW_TRANSLATION_MS} ms over 2.5 s)` : '');

export type MtProviderId = ServerMtProvider;
export type TranslatorId = MtProviderId | 'on-device';
export type MtPreference = 'auto' | TranslatorId;
export const MT_PREFERENCE_STORAGE_KEY = 'overheard.mtProvider';
export const PIP_LINES_STORAGE_KEY = 'overheard.pipLines';
export const PIP_SIZE_STORAGE_KEY = 'overheard.pipSize';
/** Who did the most recent translation, shown so nobody has to guess whether text left the device. */
export const TRANSLATED_BY: Record<TranslatorId, { label: string; tone: 'local' | 'free' | 'paid'; title: string }> = {
  'on-device': {
    label: 'this device',
    tone: 'local',
    title:
      'Translated on this device, by Chrome or by Firefox Translations (Bergamot). The text did not leave this computer.',
  },
  gtx: {
    label: 'Google, free',
    tone: 'free',
    title: 'Translated online by Google’s free translator. The text was sent to Google.',
  },
  'google-cloud': {
    label: 'Google Cloud, paid',
    tone: 'paid',
    title: 'Translated online by Google Cloud Translation, which costs money. The text was sent to Google.',
  },
};

export const MT_PROVIDER_LABELS: Record<MtPreference, string> = {
  auto: 'Auto',
  'google-cloud': 'Google Cloud',
  gtx: 'Free (unofficial)',
  'on-device': 'Only on this device',
};
