import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationLanguage } from '../types';

export type PiperLanguage = 'en' | 'es' | 'pt' | 'vi' | 'hi' | 'bn' | 'ur' | 'id' | 'sw' | 'tr';

export interface PiperVoiceOption {
  id: string;
  lang: PiperLanguage;
  label: string;
  shortName: string;
  gender?: 'female' | 'male';
  modelId: string;
  hfPath: string;
  speakerId: number;
  useRhasspyRepo?: boolean;
}

export const BROWSER_VOICE_ID = 'browser';
export const BROWSER_VOICE_LABEL = 'System / Browser voice';
export const VOICE_PREFS_STORAGE_KEY = 'overheard.voices';
export const VOICE_PREFS_EVENT = 'overheard:voices-changed';

export const PIPER_VOICES: readonly PiperVoiceOption[] = [
  // Spanish (Mexico)
  {
    id: 'es_MX-claude-high',
    lang: 'es',
    label: 'Claude (Female · MX)',
    shortName: 'Claude',
    gender: 'female',
    modelId: 'es_MX-claude-high',
    hfPath: 'es/es_MX/claude/high/es_MX-claude-high.onnx',
    speakerId: 0,
  },
  {
    id: 'es_MX-ald-medium',
    lang: 'es',
    label: 'Ald (Male · MX)',
    shortName: 'Ald',
    gender: 'male',
    modelId: 'es_MX-ald-medium',
    hfPath: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx',
    speakerId: 0,
  },

  // Portuguese (Brazil)
  {
    id: 'pt_BR-faber-medium',
    lang: 'pt',
    label: 'Faber (Male · BR)',
    shortName: 'Faber',
    gender: 'male',
    modelId: 'pt_BR-faber-medium',
    hfPath: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'pt_BR-cadu-medium',
    lang: 'pt',
    label: 'Cadu (Male · BR)',
    shortName: 'Cadu',
    gender: 'male',
    modelId: 'pt_BR-cadu-medium',
    hfPath: 'pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // English (US & UK)
  {
    id: 'en_US-hfc_female-medium',
    lang: 'en',
    label: 'HFC Female (Female · US)',
    shortName: 'HFC Female',
    gender: 'female',
    modelId: 'en_US-hfc_female-medium',
    hfPath: 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-kristin-medium',
    lang: 'en',
    label: 'Kristin (Female · US)',
    shortName: 'Kristin',
    gender: 'female',
    modelId: 'en_US-kristin-medium',
    hfPath: 'en/en_US/kristin/medium/en_US-kristin-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-kusal-medium',
    lang: 'en',
    label: 'Kusal (Male · US)',
    shortName: 'Kusal',
    gender: 'male',
    modelId: 'en_US-kusal-medium',
    hfPath: 'en/en_US/kusal/medium/en_US-kusal-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-ryan-high',
    lang: 'en',
    label: 'Ryan (Male · US)',
    shortName: 'Ryan',
    gender: 'male',
    modelId: 'en_US-ryan-high',
    hfPath: 'en/en_US/ryan/high/en_US-ryan-high.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-hifi_tts-low:0',
    lang: 'en',
    label: 'HiFi 92 · Cori (Female · UK/US)',
    shortName: 'Cori',
    gender: 'female',
    modelId: 'en_US-hifi_tts-low',
    hfPath: 'en/en_US/hifi_tts/low/en_US-hifi_tts-low.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'en_GB-alba-medium',
    lang: 'en',
    label: 'Alba (Female · UK)',
    shortName: 'Alba',
    gender: 'female',
    modelId: 'en_GB-alba-medium',
    hfPath: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-northern_english_male-medium',
    lang: 'en',
    label: 'Northern English (Male · UK)',
    shortName: 'Northern English',
    gender: 'male',
    modelId: 'en_GB-northern_english_male-medium',
    hfPath: 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-semaine-medium:0',
    lang: 'en',
    label: 'Semaine · Prudence (Female · UK)',
    shortName: 'Prudence',
    gender: 'female',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-semaine-medium:3',
    lang: 'en',
    label: 'Semaine · Poppy (Female · UK)',
    shortName: 'Poppy',
    gender: 'female',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 3,
  },
  {
    id: 'en_GB-semaine-medium:1',
    lang: 'en',
    label: 'Semaine · Spike (Male · UK)',
    shortName: 'Spike',
    gender: 'male',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 1,
  },
  {
    id: 'en_GB-semaine-medium:2',
    lang: 'en',
    label: 'Semaine · Obadiah (Male · UK)',
    shortName: 'Obadiah',
    gender: 'male',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 2,
  },

  // Vietnamese
  {
    id: 'vi_VN-vais1000-medium',
    lang: 'vi',
    label: 'VAIS (VN)',
    shortName: 'VAIS',
    modelId: 'vi_VN-vais1000-medium',
    hfPath: 'vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'vi_VN-25hours_single-low',
    lang: 'vi',
    label: '25 Hours (VN · smaller)',
    shortName: '25 Hours',
    modelId: 'vi_VN-25hours_single-low',
    hfPath: 'vi/vi_VN/25hours_single/low/vi_VN-25hours_single-low.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Hindi (India)
  {
    id: 'hi_IN-rohan-medium',
    lang: 'hi',
    label: 'Rohan (Male · IN)',
    shortName: 'Rohan',
    gender: 'male',
    modelId: 'hi_IN-rohan-medium',
    hfPath: 'hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'hi_IN-priyamvada-medium',
    lang: 'hi',
    label: 'Priyamvada (IN)',
    shortName: 'Priyamvada',
    modelId: 'hi_IN-priyamvada-medium',
    hfPath: 'hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'hi_IN-pratham-medium',
    lang: 'hi',
    label: 'Pratham (IN)',
    shortName: 'Pratham',
    modelId: 'hi_IN-pratham-medium',
    hfPath: 'hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Bengali (Bangladesh). One 16-speaker model; speaker 0 for now.
  {
    id: 'bn_BD-google-medium:0',
    lang: 'bn',
    label: 'Google (BD)',
    shortName: 'Google',
    modelId: 'bn_BD-google-medium',
    hfPath: 'bn/bn_BD/google/medium/bn_BD-google-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Urdu (Pakistan)
  {
    id: 'ur_PK-aegis_female-medium',
    lang: 'ur',
    label: 'Aegis (Female · PK)',
    shortName: 'Aegis',
    gender: 'female',
    modelId: 'ur_PK-aegis_female-medium',
    hfPath: 'ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'ur_PK-fasih-medium',
    lang: 'ur',
    label: 'Fasih (Male · PK)',
    shortName: 'Fasih',
    gender: 'male',
    modelId: 'ur_PK-fasih-medium',
    hfPath: 'ur/ur_PK/fasih/medium/ur_PK-fasih-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Indonesian
  {
    id: 'id_ID-news_tts-medium',
    lang: 'id',
    label: 'News (ID)',
    shortName: 'News',
    modelId: 'id_ID-news_tts-medium',
    hfPath: 'id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Swahili
  {
    id: 'sw_CD-lanfrica-medium',
    lang: 'sw',
    label: 'Lanfrica (CD)',
    shortName: 'Lanfrica',
    modelId: 'sw_CD-lanfrica-medium',
    hfPath: 'sw/sw_CD/lanfrica/medium/sw_CD-lanfrica-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Turkish
  {
    id: 'tr_TR-dfki-medium',
    lang: 'tr',
    label: 'DFKI (TR)',
    shortName: 'DFKI',
    modelId: 'tr_TR-dfki-medium',
    hfPath: 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
];

export const DEFAULT_PIPER_VOICE_ID: Record<PiperLanguage, string> = {
  en: 'en_US-hfc_female-medium',
  es: 'es_MX-claude-high',
  pt: 'pt_BR-faber-medium',
  vi: 'vi_VN-vais1000-medium',
  hi: 'hi_IN-rohan-medium',
  bn: 'bn_BD-google-medium:0',
  ur: 'ur_PK-aegis_female-medium',
  id: 'id_ID-news_tts-medium',
  sw: 'sw_CD-lanfrica-medium',
  tr: 'tr_TR-dfki-medium',
};

const VOICE_MAP = new Map<string, PiperVoiceOption>(PIPER_VOICES.map((v) => [v.id, v]));

export type VoicePreferences = Partial<Record<ConversationLanguage, string>>;

export function hasPiperVoices(lang: ConversationLanguage): lang is PiperLanguage {
  return Object.prototype.hasOwnProperty.call(DEFAULT_PIPER_VOICE_ID, lang);
}

export function voicesForLanguage(lang: ConversationLanguage): PiperVoiceOption[] {
  if (!hasPiperVoices(lang)) return [];
  return PIPER_VOICES.filter((voice) => voice.lang === lang);
}

export function findPiperVoice(id: string | null | undefined): PiperVoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_MAP.get(id);
}

export function voicePreviewText(
  lang: PiperLanguage,
  voiceId: string,
): { spoken: string; englishHint: string } {
  const voice = findPiperVoice(voiceId);
  const shortName = voice?.shortName ?? 'the browser voice';
  switch (lang) {
    case 'en': {
      const spoken = `Hi, I'm ${shortName}. Should I be your reader for English?`;
      return { spoken, englishHint: spoken };
    }
    case 'es': {
      const role = voice?.gender === 'female' ? 'lectora' : 'lector';
      return {
        spoken: `Hola, soy ${shortName}. ¿Debería ser tu ${role} de español?`,
        englishHint: `Hi, I'm ${shortName}. Should I be your reader for Spanish?`,
      };
    }
    case 'pt': {
      return {
        spoken: `Olá, eu sou ${shortName}. Devo ser o seu leitor de português?`,
        englishHint: `Hi, I'm ${shortName}. Should I be your reader for Portuguese?`,
      };
    }
    case 'vi': {
      return {
        spoken: `Xin chào, tôi là ${shortName}. Tôi có thể đọc tiếng Việt cho bạn không?`,
        englishHint: `Hi, I'm ${shortName}. Can I read Vietnamese for you?`,
      };
    }
    case 'hi': {
      return {
        spoken: `नमस्ते, मैं ${shortName} हूँ। क्या मैं आपके लिए हिन्दी पढ़ूँ?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Hindi for you?`,
      };
    }
    case 'bn': {
      return {
        spoken: `হ্যালো, আমি ${shortName}। আমি কি আপনার জন্য বাংলা পড়ব?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Bengali for you?`,
      };
    }
    case 'ur': {
      return {
        spoken: `السلام علیکم، میں ${shortName} ہوں۔ کیا میں آپ کے لیے اردو پڑھوں؟`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Urdu for you?`,
      };
    }
    case 'id': {
      return {
        spoken: `Halo, saya ${shortName}. Boleh saya bacakan bahasa Indonesia untuk Anda?`,
        englishHint: `Hi, I'm ${shortName}. May I read Indonesian for you?`,
      };
    }
    case 'sw': {
      return {
        spoken: `Habari, mimi ni ${shortName}. Nikusomee Kiswahili?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Swahili for you?`,
      };
    }
    case 'tr': {
      return {
        spoken: `Merhaba, ben ${shortName}. Sizin için Türkçe okuyayım mı?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Turkish for you?`,
      };
    }
  }
}

export function isValidVoiceForLanguage(lang: ConversationLanguage, voiceId: unknown): voiceId is string {
  if (voiceId === BROWSER_VOICE_ID) return true;
  if (typeof voiceId !== 'string') return false;
  const voice = VOICE_MAP.get(voiceId);
  return Boolean(voice && voice.lang === lang);
}

export function resolveVoiceId(lang: ConversationLanguage, prefs?: VoicePreferences): string {
  const saved = prefs?.[lang];
  if (isValidVoiceForLanguage(lang, saved)) {
    return saved;
  }
  return hasPiperVoices(lang) ? DEFAULT_PIPER_VOICE_ID[lang] : BROWSER_VOICE_ID;
}

export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: VoicePreferences = {};
    for (const [lang, value] of Object.entries(parsed)) {
      if (isValidVoiceForLanguage(lang as ConversationLanguage, value)) {
        result[lang as ConversationLanguage] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveVoicePreferences(prefs: VoicePreferences): void {
  try {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(VOICE_PREFS_EVENT));
    }
  } catch {
    /* Storage may be unavailable. */
  }
}

export function useVoicePreferences(): [
  VoicePreferences,
  (lang: ConversationLanguage, voiceId: string) => void,
] {
  const [voicePrefs, setVoicePrefs] = useState<VoicePreferences>(loadVoicePreferences);
  const prefsRef = useRef(voicePrefs);
  prefsRef.current = voicePrefs;

  useEffect(() => {
    const sync = () => {
      const loaded = loadVoicePreferences();
      prefsRef.current = loaded;
      setVoicePrefs(loaded);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === VOICE_PREFS_STORAGE_KEY || event.key === null) sync();
    };
    window.addEventListener(VOICE_PREFS_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(VOICE_PREFS_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const updateVoicePref = useCallback((lang: ConversationLanguage, voiceId: string) => {
    const next = { ...prefsRef.current, [lang]: voiceId };
    prefsRef.current = next;
    setVoicePrefs(next);
    saveVoicePreferences(next);
  }, []);

  return [voicePrefs, updateVoicePref];
}
