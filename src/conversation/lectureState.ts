import { SUPPORTED_LANGUAGES } from '../constants';
import type { LanguageCode } from '../types';

export const LECTURE_STORAGE_KEY = 'overheard.lecture';

export interface LectureEntry {
  id: string;
  timestamp: number;
  english: string;
  translations: Partial<Record<LanguageCode, string>>;
  failedLangs: Partial<Record<LanguageCode, boolean>>;
}

const VALID_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

let nextLectureId = 0;

export function createLectureEntry(english: string, timestamp = Date.now()): LectureEntry {
  return {
    id: `lec-${timestamp}-${++nextLectureId}`,
    timestamp,
    english: english.trim(),
    translations: {},
    failedLangs: {},
  };
}

export type LectureAction =
  | { type: 'replace'; entries: LectureEntry[] }
  | { type: 'add'; entry: LectureEntry }
  | { type: 'resolve'; id: string; lang: LanguageCode; translation: string | null }
  | { type: 'clear' };

export function lectureReducer(entries: LectureEntry[], action: LectureAction): LectureEntry[] {
  switch (action.type) {
    case 'replace':
      return action.entries;
    case 'clear':
      return [];
    case 'add':
      return action.entry.english ? [...entries, action.entry] : entries;
    case 'resolve':
      return entries.map((entry) => {
        if (entry.id !== action.id) return entry;
        if (action.translation === null) {
          return {
            ...entry,
            failedLangs: { ...entry.failedLangs, [action.lang]: true },
          };
        }
        const nextFailed = { ...entry.failedLangs };
        delete nextFailed[action.lang];
        return {
          ...entry,
          translations: { ...entry.translations, [action.lang]: action.translation },
          failedLangs: nextFailed,
        };
      });
  }
}

export function loadLectureEntries(): LectureEntry[] {
  try {
    const raw = localStorage.getItem(LECTURE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: LectureEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const english = typeof item.english === 'string' ? item.english.trim() : '';
      if (!english) continue;
      const timestamp =
        typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
          ? item.timestamp
          : Date.now();
      const translations: Partial<Record<LanguageCode, string>> = {};
      if (item.translations && typeof item.translations === 'object') {
        for (const [code, value] of Object.entries(item.translations)) {
          if (VALID_CODES.has(code) && typeof value === 'string' && value.trim()) {
            translations[code as LanguageCode] = value;
          }
        }
      }
      const failedLangs: Partial<Record<LanguageCode, boolean>> = {};
      if (item.failedLangs && typeof item.failedLangs === 'object') {
        for (const [code, value] of Object.entries(item.failedLangs)) {
          if (VALID_CODES.has(code) && value === true) {
            failedLangs[code as LanguageCode] = true;
          }
        }
      }
      valid.push({
        id: typeof item.id === 'string' && item.id ? item.id : `lec-${timestamp}-${++nextLectureId}`,
        timestamp,
        english,
        translations,
        failedLangs,
      });
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveLectureEntries(entries: LectureEntry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(LECTURE_STORAGE_KEY);
    } else {
      localStorage.setItem(LECTURE_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    /* Storage quota or private mode: keep in-memory session functional. */
  }
}
