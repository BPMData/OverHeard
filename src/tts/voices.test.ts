// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_VOICE_ID,
  DEFAULT_PIPER_VOICE_ID,
  PIPER_VOICES,
  VOICE_PREFS_STORAGE_KEY,
  findPiperVoice,
  hasPiperVoices,
  loadVoicePreferences,
  resolveVoiceId,
  saveVoicePreferences,
  voicePreviewText,
  voicesForLanguage,
} from './voices';

beforeEach(() => {
  localStorage.clear();
});

describe('Piper voice catalog and preferences', () => {
  it('contains the curated Spanish, Brazilian Portuguese, and US/UK English voices', () => {
    expect(voicesForLanguage('es').map((v) => v.id)).toEqual([
      'es_MX-claude-high',
      'es_MX-ald-medium',
    ]);
    expect(voicesForLanguage('pt').map((v) => v.id)).toEqual([
      'pt_BR-faber-medium',
      'pt_BR-cadu-medium',
    ]);
    expect(voicesForLanguage('en').map((v) => v.id)).toEqual([
      'en_US-hfc_female-medium',
      'en_US-kristin-medium',
      'en_US-kusal-medium',
      'en_US-ryan-high',
      'en_US-hifi_tts-low:0',
      'en_GB-alba-medium',
      'en_GB-northern_english_male-medium',
      'en_GB-semaine-medium:0',
      'en_GB-semaine-medium:3',
      'en_GB-semaine-medium:1',
      'en_GB-semaine-medium:2',
    ]);
    expect(voicesForLanguage('vi').map((v) => v.id)).toEqual([
      'vi_VN-vais1000-medium',
      'vi_VN-25hours_single-low',
    ]);
    expect(voicesForLanguage('hi').map((v) => v.id)).toEqual([
      'hi_IN-rohan-medium',
      'hi_IN-priyamvada-medium',
      'hi_IN-pratham-medium',
    ]);
    expect(voicesForLanguage('bn').map((v) => v.id)).toEqual(['bn_BD-google-medium:0']);
    expect(voicesForLanguage('ur').map((v) => v.id)).toEqual([
      'ur_PK-aegis_female-medium',
      'ur_PK-fasih-medium',
    ]);
    expect(voicesForLanguage('id').map((v) => v.id)).toEqual(['id_ID-news_tts-medium']);
    expect(voicesForLanguage('sw').map((v) => v.id)).toEqual(['sw_CD-lanfrica-medium']);
    expect(voicesForLanguage('tr').map((v) => v.id)).toEqual(['tr_TR-dfki-medium']);
    expect(voicesForLanguage('ja')).toEqual([]);
    expect(PIPER_VOICES).toHaveLength(26);
    expect(voicesForLanguage('fr')).toEqual([]);
    expect(hasPiperVoices('es')).toBe(true);
    expect(hasPiperVoices('pt')).toBe(true);
    expect(hasPiperVoices('en')).toBe(true);
    expect(hasPiperVoices('vi')).toBe(true);
    expect(hasPiperVoices('hi')).toBe(true);
    expect(hasPiperVoices('bn')).toBe(true);
    expect(hasPiperVoices('ar')).toBe(false);
  });

  it('configures multi-speaker and rhasspy-hosted voice metadata accurately', () => {
    expect(findPiperVoice('pt_BR-cadu-medium')).toMatchObject({
      modelId: 'pt_BR-cadu-medium',
      hfPath: 'pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx',
      useRhasspyRepo: true,
    });
    expect(findPiperVoice('en_US-hifi_tts-low:0')).toMatchObject({
      modelId: 'en_US-hifi_tts-low',
      hfPath: 'en/en_US/hifi_tts/low/en_US-hifi_tts-low.onnx',
      speakerId: 0,
      useRhasspyRepo: true,
    });
    for (const voice of PIPER_VOICES.filter((v) =>
      ['vi', 'hi', 'bn', 'ur', 'id', 'sw', 'tr'].includes(v.lang)
    )) {
      // These models are newer than the default mirror, so they load from rhasspy.
      expect(voice.useRhasspyRepo).toBe(true);
      expect(voice.hfPath).toBe(
        `${voice.lang}/${voice.modelId.split('-')[0]}/${voice.modelId.split('-')[1]}/` +
          `${voice.modelId.split('-')[2]}/${voice.modelId}.onnx`
      );
    }
    expect(findPiperVoice('en_GB-semaine-medium:0')?.speakerId).toBe(0);
    expect(findPiperVoice('en_GB-semaine-medium:1')?.speakerId).toBe(1);
    expect(findPiperVoice('en_GB-semaine-medium:2')?.speakerId).toBe(2);
    expect(findPiperVoice('en_GB-semaine-medium:3')?.speakerId).toBe(3);
  });

  it('resolves default, saved, and fallback browser voices cleanly', () => {
    expect(resolveVoiceId('en')).toBe(DEFAULT_PIPER_VOICE_ID.en);
    expect(resolveVoiceId('es')).toBe(DEFAULT_PIPER_VOICE_ID.es);
    expect(resolveVoiceId('pt')).toBe(DEFAULT_PIPER_VOICE_ID.pt);
    expect(resolveVoiceId('hi')).toBe('hi_IN-rohan-medium');
    expect(resolveVoiceId('bn')).toBe('bn_BD-google-medium:0');
    expect(resolveVoiceId('vi')).toBe('vi_VN-vais1000-medium');
    expect(resolveVoiceId('ur')).toBe('ur_PK-aegis_female-medium');
    expect(resolveVoiceId('ja')).toBe(BROWSER_VOICE_ID);
    expect(resolveVoiceId('fr')).toBe(BROWSER_VOICE_ID);

    expect(resolveVoiceId('es', { es: 'es_MX-ald-medium' })).toBe('es_MX-ald-medium');
    expect(resolveVoiceId('pt', { pt: BROWSER_VOICE_ID })).toBe(BROWSER_VOICE_ID);
    // Rejects a voice that belongs to a different language or does not exist
    expect(resolveVoiceId('es', { es: 'pt_BR-cadu-medium' })).toBe(DEFAULT_PIPER_VOICE_ID.es);
    expect(resolveVoiceId('en', { en: 'unknown-voice' })).toBe(DEFAULT_PIPER_VOICE_ID.en);
  });

  it('persists voice preferences to localStorage and handles corrupt or blocked storage', () => {
    saveVoicePreferences({
      en: 'en_GB-semaine-medium:3',
      es: 'es_MX-ald-medium',
      pt: 'pt_BR-cadu-medium',
    });
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_STORAGE_KEY)!)).toEqual({
      en: 'en_GB-semaine-medium:3',
      es: 'es_MX-ald-medium',
      pt: 'pt_BR-cadu-medium',
    });
    expect(loadVoicePreferences()).toEqual({
      en: 'en_GB-semaine-medium:3',
      es: 'es_MX-ald-medium',
      pt: 'pt_BR-cadu-medium',
    });

    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, '{invalid-json');
    expect(loadVoicePreferences()).toEqual({});

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveVoicePreferences({ en: 'en_US-ryan-high' })).not.toThrow();
    expect(loadVoicePreferences()).toEqual({});
    vi.restoreAllMocks();
  });

  it('builds localized preview phrases for English, Spanish, and Portuguese voices', () => {
    expect(voicePreviewText('en', 'en_US-kristin-medium')).toEqual({
      spoken: "Hi, I'm Kristin. Should I be your reader for English?",
      englishHint: "Hi, I'm Kristin. Should I be your reader for English?",
    });
    expect(voicePreviewText('es', 'es_MX-claude-high')).toEqual({
      spoken: 'Hola, soy Claude. ¿Debería ser tu lectora de español?',
      englishHint: "Hi, I'm Claude. Should I be your reader for Spanish?",
    });
    expect(voicePreviewText('es', 'es_MX-ald-medium').spoken).toContain('tu lector de español');
    expect(voicePreviewText('pt', 'pt_BR-cadu-medium')).toEqual({
      spoken: 'Olá, eu sou Cadu. Devo ser o seu leitor de português?',
      englishHint: "Hi, I'm Cadu. Should I be your reader for Portuguese?",
    });
    expect(voicePreviewText('hi', 'hi_IN-rohan-medium').spoken).toContain('मैं Rohan हूँ');
    expect(voicePreviewText('bn', 'bn_BD-google-medium:0').englishHint).toContain('Bengali');
    expect(voicePreviewText('vi', 'vi_VN-vais1000-medium').spoken).toContain('tiếng Việt');
    expect(voicePreviewText('ur', 'ur_PK-fasih-medium').spoken).toContain('میں Fasih ہوں');
    expect(voicePreviewText('id', 'id_ID-news_tts-medium').spoken).toContain('bahasa Indonesia');
    expect(voicePreviewText('sw', 'sw_CD-lanfrica-medium').spoken).toContain('Kiswahili');
    expect(voicePreviewText('tr', 'tr_TR-dfki-medium').spoken).toContain('Türkçe');
  });
});
