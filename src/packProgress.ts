import { LANGUAGE_MAP } from './constants';
import type { LanguageCode } from './types';

/**
 * Progress keys used by the on-device download panel:
 * - a language code (`es`, `en`) is the translation pack for translating into that language
 * - `speech` is the English speech pack used by the caption modes
 * - `speech:<code>` is the speech pack for one language, used by Conversation mode
 */
const languageName = (code: string): string =>
  code === 'en' ? 'English' : (LANGUAGE_MAP[code as LanguageCode]?.name ?? code);

export function packLabel(key: string): string {
  if (key === 'speech') return 'English speech';
  if (key.startsWith('speech:')) return `${languageName(key.slice('speech:'.length))} speech`;
  return `${languageName(key)} translation`;
}

export const formatElapsed = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
