import { describe, expect, it } from 'vitest';
import { SPEECH_LOCALES, speechLocale } from './locales';
describe('speech locales', () => {
  it('maps every specified language', () => {
    expect(SPEECH_LOCALES).toEqual({
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
    });
    for (const [code, locale] of Object.entries(SPEECH_LOCALES))
      expect(speechLocale(code)).toBe(locale);
  });
  it('falls back to the supplied code', () => expect(speechLocale('xx')).toBe('xx'));
});
