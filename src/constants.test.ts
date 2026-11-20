import { describe, expect, it } from 'vitest';
import { LANGUAGE_MAP, SUPPORTED_LANGUAGES, VALID_LANGUAGE_CODES } from './constants';
import { SPEECH_LOCALES } from './conversation/locales';
import { ROOM_LANGUAGES } from './rooms/protocol';

describe('supported languages', () => {
  it('lists the same languages for captions, lecture rooms and speech recognition', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual([...ROOM_LANGUAGES]);
    for (const code of codes) {
      expect(VALID_LANGUAGE_CODES.has(code)).toBe(true);
      expect(SPEECH_LOCALES[code]).toBeTruthy();
    }
  });

  it('includes Hindi and Bengali as left-to-right languages', () => {
    expect(LANGUAGE_MAP.hi).toMatchObject({ name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' });
    expect(LANGUAGE_MAP.bn).toMatchObject({ name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr' });
    expect(SPEECH_LOCALES.hi).toBe('hi-IN');
    expect(SPEECH_LOCALES.bn).toBe('bn-BD');
  });

  it('includes Urdu as right-to-left and the other new languages as left-to-right', () => {
    expect(LANGUAGE_MAP.ur.dir).toBe('rtl');
    for (const code of ['id', 'ja', 'sw', 'tr'] as const) expect(LANGUAGE_MAP[code].dir).toBe('ltr');
  });
});
