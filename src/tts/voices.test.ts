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
    expect(voicesForLanguage('es').map((v) => v.id)).toEqual(['es_MX-claude-high', 'es_MX-ald-medium']);
    expect(voicesForLanguage('pt').map((v) => v.id)).toEqual(['pt_BR-faber-medium', 'pt_BR-cadu-medium']);
    expect(voicesForLanguage('en').map((v) => v.id)).toEqual([
      'en_US-hfc_female-medium',
      'en_US-kristin-medium',
      'en_US-kusal-medium',
      'en_US-ryan-high',
      'en_GB-alba-medium',
      'en_GB-northern_english_male-medium',
      'en_GB-semaine-medium:0',
      'en_GB-semaine-medium:3',
      'en_GB-semaine-medium:1',
      'en_GB-semaine-medium:2',
    ]);
    expect(voicesForLanguage('vi').map((v) => v.id)).toEqual(['vi_VN-vais1000-medium', 'vi_VN-25hours_single-low']);
    expect(voicesForLanguage('hi').map((v) => v.id)).toEqual(['hi_IN-priyamvada-medium', 'hi_IN-pratham-medium']);
    expect(voicesForLanguage('bn').map((v) => v.id)).toEqual(['bn_BD-google-medium:0', 'bn_BD-google-medium:3']);
    expect(voicesForLanguage('ur').map((v) => v.id)).toEqual(['ur_PK-aegis_female-medium', 'ur_PK-fasih-medium']);
    expect(voicesForLanguage('id').map((v) => v.id)).toEqual(['mms-tts-ind', 'id_ID-news_tts-medium']);
    expect(voicesForLanguage('sw').map((v) => v.id)).toEqual(['mms-tts-swh']);
    expect(voicesForLanguage('tr').map((v) => v.id)).toEqual(['mms-tts-tur', 'tr_TR-dfki-medium']);
    expect(voicesForLanguage('ht').map((v) => v.id)).toEqual(['mms-tts-hat']);
    expect(voicesForLanguage('so').map((v) => v.id)).toEqual(['mms-tts-som']);
    expect(voicesForLanguage('zh').map((v) => v.id)).toEqual(['zh_CN-xiao_ya-medium', 'zh_CN-chaowen-medium']);
    expect(voicesForLanguage('ar').map((v) => v.id)).toEqual(['ar_JO-kareem-medium']);
    expect(voicesForLanguage('fr').map((v) => v.id)).toEqual([
      'fr_FR-siwis-medium',
      'fr_FR-tom-medium',
      'fr_FR-upmc-medium:0',
      'fr_FR-upmc-medium:1',
    ]);
    expect(voicesForLanguage('uk').map((v) => v.shortName)).toEqual(['Tetiana', 'Mykyta', 'Oleksa']);
    expect(voicesForLanguage('ru').map((v) => v.shortName)).toEqual(['Irina', 'Dmitri']);
    expect(voicesForLanguage('prs').map((v) => v.shortName)).toEqual(['Magnoliasis', 'Amir', 'Ganji Adabi']);
    expect(voicesForLanguage('zh').every((v) => v.phonemeType === 'pinyin')).toBe(true);
    expect(voicesForLanguage('ja')).toEqual([]);
    expect(PIPER_VOICES).toHaveLength(44);
    expect(voicesForLanguage('ps')).toEqual([]);
    expect(hasPiperVoices('es')).toBe(true);
    expect(hasPiperVoices('pt')).toBe(true);
    expect(hasPiperVoices('en')).toBe(true);
    expect(hasPiperVoices('vi')).toBe(true);
    expect(hasPiperVoices('hi')).toBe(true);
    expect(hasPiperVoices('bn')).toBe(true);
    expect(hasPiperVoices('ps')).toBe(false);
  });

  it('configures multi-speaker and rhasspy-hosted voice metadata accurately', () => {
    expect(findPiperVoice('pt_BR-cadu-medium')).toMatchObject({
      modelId: 'pt_BR-cadu-medium',
      hfPath: 'pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx',
      useRhasspyRepo: true,
    });
    for (const voice of PIPER_VOICES.filter(
      (v) => ['vi', 'hi', 'bn', 'ur', 'id', 'sw', 'tr', 'zh'].includes(v.lang) && v.engine !== 'mms'
    )) {
      // These models are newer than the default mirror, so they load from rhasspy.
      expect(voice.useRhasspyRepo).toBe(true);
      expect(voice.hfPath).toBe(
        `${voice.lang}/${voice.modelId.split('-')[0]}/${voice.modelId.split('-')[1]}/` +
          `${voice.modelId.split('-')[2]}/${voice.modelId}.onnx`
      );
    }
    expect(findPiperVoice('bn_BD-google-medium:3')?.speakerId).toBe(3);
    expect(findPiperVoice('en_GB-semaine-medium:0')?.speakerId).toBe(0);
    expect(findPiperVoice('en_GB-semaine-medium:1')?.speakerId).toBe(1);
    expect(findPiperVoice('en_GB-semaine-medium:2')?.speakerId).toBe(2);
    expect(findPiperVoice('en_GB-semaine-medium:3')?.speakerId).toBe(3);
  });

  it('resolves default, saved, and fallback browser voices cleanly', () => {
    expect(resolveVoiceId('en')).toBe(DEFAULT_PIPER_VOICE_ID.en);
    expect(resolveVoiceId('es')).toBe(DEFAULT_PIPER_VOICE_ID.es);
    expect(resolveVoiceId('pt')).toBe(DEFAULT_PIPER_VOICE_ID.pt);
    expect(resolveVoiceId('hi')).toBe('hi_IN-priyamvada-medium');
    expect(resolveVoiceId('bn')).toBe('bn_BD-google-medium:0');
    expect(resolveVoiceId('vi')).toBe('vi_VN-vais1000-medium');
    expect(resolveVoiceId('ur')).toBe('ur_PK-aegis_female-medium');
    expect(resolveVoiceId('ja')).toBe(BROWSER_VOICE_ID);
    expect(resolveVoiceId('ps')).toBe(BROWSER_VOICE_ID);

    expect(resolveVoiceId('es', { es: 'es_MX-ald-medium' })).toBe('es_MX-ald-medium');
    expect(resolveVoiceId('pt', { pt: BROWSER_VOICE_ID })).toBe(BROWSER_VOICE_ID);
    // Rejects a voice that belongs to a different language or does not exist
    expect(resolveVoiceId('es', { es: 'pt_BR-cadu-medium' })).toBe(DEFAULT_PIPER_VOICE_ID.es);
    expect(resolveVoiceId('en', { en: 'unknown-voice' })).toBe(DEFAULT_PIPER_VOICE_ID.en);
    // Cori (en_US-hifi_tts-low) was removed when its model vanished from Hugging Face;
    // anyone who had saved it falls back to the default English voice.
    expect(findPiperVoice('en_US-hifi_tts-low:0')).toBeUndefined();
    expect(resolveVoiceId('en', { en: 'en_US-hifi_tts-low:0' })).toBe(DEFAULT_PIPER_VOICE_ID.en);
    localStorage.setItem(
      VOICE_PREFS_STORAGE_KEY,
      JSON.stringify({ en: 'en_US-hifi_tts-low:0', es: 'es_MX-ald-medium' })
    );
    expect(loadVoicePreferences()).toEqual({ es: 'es_MX-ald-medium' });
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
    expect(voicePreviewText('hi', 'hi_IN-pratham-medium').spoken).toContain('मैं Pratham हूँ');
    expect(voicePreviewText('bn', 'bn_BD-google-medium:0').englishHint).toContain('Bengali');
    expect(voicePreviewText('vi', 'vi_VN-vais1000-medium').spoken).toContain('tiếng Việt');
    expect(voicePreviewText('ur', 'ur_PK-fasih-medium').spoken).toContain('میں Fasih ہوں');
    expect(voicePreviewText('id', 'id_ID-news_tts-medium').spoken).toContain('bahasa Indonesia');
    expect(voicePreviewText('sw', 'mms-tts-swh').spoken).toBe('Habari, mimi ni Baraka. Nikusomee Kiswahili?');
    expect(voicePreviewText('tr', 'tr_TR-dfki-medium').spoken).toContain('Türkçe');
    expect(voicePreviewText('ht', 'mms-tts-hat').spoken).toContain('kreyòl ayisyen');
    expect(voicePreviewText('so', 'mms-tts-som').spoken).toContain('af Soomaali');
  });
});

describe('voice download sizes', () => {
  it('knows a size for every voice, and none for the browser voice', async () => {
    const { PIPER_VOICES, BROWSER_VOICE_ID, voiceDownloadBytes, voiceDownloadLabel } = await import('./voices');
    for (const voice of PIPER_VOICES) {
      expect(voiceDownloadBytes(voice.id)).toBeGreaterThan(10 * 1024 * 1024);
    }
    expect(voiceDownloadBytes(BROWSER_VOICE_ID)).toBe(0);
    expect(voiceDownloadLabel('es_MX-claude-high')).toBe('60 MB');
    expect(voiceDownloadLabel('uk_UA-tetiana-high')).toBe('109 MB');
    expect(voiceDownloadLabel(BROWSER_VOICE_ID)).toBe('');
  });
});

describe('Meta MMS voices', () => {
  it('are a second engine with their own download URL, size and attribution', async () => {
    const { MMS_ATTRIBUTION, mmsVoiceUrl, voiceDownloadLabel, voiceEngine } = await import('./voices');
    const mms = PIPER_VOICES.filter((voice) => voiceEngine(voice) === 'mms');
    expect(mms.map((voice) => voice.mmsIso3)).toEqual(['ind', 'swh', 'tur', 'hat', 'som']);
    for (const voice of mms) {
      expect(voice).toMatchObject({
        id: `mms-tts-${voice.mmsIso3}`,
        modelId: `mms-tts-${voice.mmsIso3}`,
        gender: 'male',
      });
      expect(voice.label).toContain('Meta MMS');
      expect(voiceDownloadLabel(voice.id)).toBe('28 MB');
      const file = voice.mmsIso3 === 'ind' ? 'model_quantized_rate088.onnx' : 'model_quantized.onnx';
      expect(mmsVoiceUrl(voice)).toBe(`https://bpmdata.github.io/overheard-voices/mms-tts-${voice.mmsIso3}/${file}`);
    }
    expect(voiceEngine(findPiperVoice('tr_TR-dfki-medium')!)).toBe('piper');
    expect(MMS_ATTRIBUTION.text).toContain('CC BY-NC 4.0');
  });

  it('are the defaults for Swahili, Indonesian, Turkish, Haitian Creole and Somali', () => {
    expect(resolveVoiceId('sw')).toBe('mms-tts-swh');
    expect(resolveVoiceId('id')).toBe('mms-tts-ind');
    expect(resolveVoiceId('tr')).toBe('mms-tts-tur');
    expect(resolveVoiceId('ht')).toBe('mms-tts-hat');
    expect(resolveVoiceId('so')).toBe('mms-tts-som');
    // Swahili Lanfrica was replaced; anyone who had picked it gets the MMS voice.
    expect(resolveVoiceId('sw', { sw: 'sw_CD-lanfrica-medium' })).toBe('mms-tts-swh');
    expect(resolveVoiceId('tr', { tr: 'tr_TR-dfki-medium' })).toBe('tr_TR-dfki-medium');
  });
});
