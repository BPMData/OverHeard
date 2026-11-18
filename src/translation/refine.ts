import type { MtPreference, TranslatorId } from '../app/settings';
import type { CaptionSegment, ConversationLanguage, LanguageCode } from '../types';

export async function refineCaption({
  phrase, langs, contextSnapshot, preference, refineEnabled, getMtProvider, fetchTranslationWithRetry, patch,
}: {
  phrase: string;
  langs: LanguageCode[];
  contextSnapshot: string[];
  preference: MtPreference;
  refineEnabled: boolean;
  getMtProvider: (preference: MtPreference, source: ConversationLanguage, lang: ConversationLanguage, text: string) => TranslatorId | undefined;
  fetchTranslationWithRetry: (phrase: string, langs: LanguageCode[], context: string[]) => Promise<Record<string, string>>;
  patch: (update: (segment: CaptionSegment) => CaptionSegment) => void;
}) {
  // Optional Gemini clean-up, only for languages that weren't translated on this device
  // (so on-device text never leaves the machine, and the server's Gemini calls stay low).
  // "On this device" mode skips it entirely.
  const refineLangs =
    !refineEnabled ||
    preference === 'on-device'
      ? []
      : langs.filter(
          (code) =>
            getMtProvider(preference, 'en', code, phrase) !==
            'on-device'
        );
  if (refineLangs.length === 0) return;
  const refined = await fetchTranslationWithRetry(
    phrase,
    refineLangs,
    contextSnapshot
  ).catch(() => null);
  if (!refined) return;
  patch((seg) => {
    const merged = { ...seg.translations };
    for (const code of refineLangs) {
      const value = refined[code];
      if (value && value !== 'translation unavailable') merged[code] = value;
    }
    return { ...seg, translations: merged, status: 'done' };
  });
}
