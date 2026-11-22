import { VALID_LANGUAGE_CODES } from '../constants';
import type { LanguageCode, PipLayout, PipLine } from '../types';

export const STUDENT_PREFS_STORAGE_KEY = 'overheard.studentPrefs';
export const LISTENING_PIP_LAYOUT_STORAGE_KEY = 'overheard.pipLayout';

export interface StudentPrefs {
  isDark: boolean;
  language: LanguageCode | 'en';
  fontSize: number;
  /** Never send text to an online translator from this page (the student's own choice) */
  onDeviceOnly: boolean;
}

export interface PipPrefs {
  lines: PipLine[];
  layout: PipLayout;
}

const DEFAULT_STUDENT_PREFS: StudentPrefs = {
  isDark: true,
  language: 'es',
  fontSize: 28,
  onDeviceOnly: false,
};

export function clampStudentFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STUDENT_PREFS.fontSize;
  return Math.min(56, Math.max(20, Math.round(value)));
}

export function loadStudentPrefs(): StudentPrefs {
  try {
    const raw = localStorage.getItem(STUDENT_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_STUDENT_PREFS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STUDENT_PREFS;
    const isDark = typeof parsed.isDark === 'boolean' ? parsed.isDark : DEFAULT_STUDENT_PREFS.isDark;
    const language =
      parsed.language === 'en' ||
      (typeof parsed.language === 'string' && VALID_LANGUAGE_CODES.has(parsed.language))
        ? (parsed.language as LanguageCode | 'en')
        : DEFAULT_STUDENT_PREFS.language;
    const fontSize = clampStudentFontSize(parsed.fontSize);
    const onDeviceOnly = parsed.onDeviceOnly === true;
    return { isDark, language, fontSize, onDeviceOnly };
  } catch {
    return DEFAULT_STUDENT_PREFS;
  }
}

export function saveStudentPrefs(prefs: StudentPrefs): void {
  try {
    localStorage.setItem(STUDENT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* Private mode or disabled storage: keep in-memory session functional. */
  }
}

export function parsePipLayout(value: unknown): PipLayout {
  return value === 'columns' ? 'columns' : 'stacked';
}

export function loadPipPrefs(prefix: string): PipPrefs {
  try {
    const rawLines = JSON.parse(localStorage.getItem(`${prefix}.lines`) || 'null');
    const lines = Array.isArray(rawLines)
      ? (rawLines.filter(
          (item): item is PipLine =>
            item === 'en' || (typeof item === 'string' && VALID_LANGUAGE_CODES.has(item)),
        ) as PipLine[])
      : [];
    const layout = parsePipLayout(localStorage.getItem(`${prefix}.layout`));
    return { lines, layout };
  } catch {
    return { lines: [], layout: 'stacked' };
  }
}

export function savePipPrefs(prefix: string, prefs: PipPrefs): void {
  try {
    localStorage.setItem(`${prefix}.lines`, JSON.stringify(prefs.lines));
    localStorage.setItem(`${prefix}.layout`, prefs.layout);
  } catch {
    /* Private mode or disabled storage: ignore write errors. */
  }
}
