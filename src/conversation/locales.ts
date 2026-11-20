/** Recognition locales, including languages whose browser support may vary. */
export const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US',
  es: 'es-US',
  pt: 'pt-BR',
  ar: 'ar-SA',
  zh: 'zh-CN',
  vi: 'vi-VN',
  fr: 'fr-FR',
  uk: 'uk-UA',
  ru: 'ru-RU',
  ht: 'ht-HT',
  so: 'so-SO',
  prs: 'fa-AF',
  ps: 'ps-AF',
  hi: 'hi-IN',
  bn: 'bn-BD',
};
export const speechLocale = (code: string): string => SPEECH_LOCALES[code] ?? code;
