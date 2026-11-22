import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationLanguage } from '../types';

export type PiperLanguage = 'en' | 'es' | 'pt' | 'vi' | 'hi' | 'bn' | 'ur' | 'id' | 'sw' | 'tr' | 'zh' | 'ar' | 'fr' | 'uk' | 'ru' | 'prs';

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
  /** Chinese voices that take pinyin instead of eSpeak phonemes (see pinyin.ts). */
  phonemeType?: 'pinyin';
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
    label: 'VAIS (Female · VN)',
    gender: 'female',
    shortName: 'VAIS',
    modelId: 'vi_VN-vais1000-medium',
    hfPath: 'vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'vi_VN-25hours_single-low',
    lang: 'vi',
    label: '25 Hours (Female · VN · smaller)',
    gender: 'female',
    shortName: '25 Hours',
    modelId: 'vi_VN-25hours_single-low',
    hfPath: 'vi/vi_VN/25hours_single/low/vi_VN-25hours_single-low.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Hindi (India)
  {
    id: 'hi_IN-priyamvada-medium',
    lang: 'hi',
    label: 'Priyamvada (Female · IN)',
    shortName: 'Priyamvada',
    gender: 'female',
    modelId: 'hi_IN-priyamvada-medium',
    hfPath: 'hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'hi_IN-pratham-medium',
    lang: 'hi',
    label: 'Pratham (Male · IN)',
    shortName: 'Pratham',
    gender: 'male',
    modelId: 'hi_IN-pratham-medium',
    hfPath: 'hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Bengali (Bangladesh). One 16-speaker model; speaker 3 is dataset speaker 03042.
  {
    id: 'bn_BD-google-medium:0',
    lang: 'bn',
    label: 'Google (Male · BD)',
    gender: 'male',
    shortName: 'Google',
    modelId: 'bn_BD-google-medium',
    hfPath: 'bn/bn_BD/google/medium/bn_BD-google-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'bn_BD-google-medium:3',
    lang: 'bn',
    label: 'Arif (Male · BD)',
    shortName: 'Arif',
    gender: 'male',
    modelId: 'bn_BD-google-medium',
    hfPath: 'bn/bn_BD/google/medium/bn_BD-google-medium.onnx',
    speakerId: 3,
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
    label: 'News (Female · ID)',
    gender: 'female',
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
    label: 'Lanfrica (Male · CD)',
    gender: 'male',
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
    label: 'DFKI (Male · TR)',
    gender: 'male',
    shortName: 'DFKI',
    modelId: 'tr_TR-dfki-medium',
    hfPath: 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Simplified Chinese. Both voices need the pinyin step in pinyin.ts.
  {
    id: 'zh_CN-xiao_ya-medium',
    lang: 'zh',
    label: 'Xiao Ya (Female · CN)',
    gender: 'female',
    shortName: 'Xiao Ya',
    modelId: 'zh_CN-xiao_ya-medium',
    hfPath: 'zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
    phonemeType: 'pinyin',
  },
  {
    id: 'zh_CN-chaowen-medium',
    lang: 'zh',
    label: 'Chaowen (Male · CN)',
    gender: 'male',
    shortName: 'Chaowen',
    modelId: 'zh_CN-chaowen-medium',
    hfPath: 'zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
    phonemeType: 'pinyin',
  },

  // Arabic (Jordan)
  {
    id: 'ar_JO-kareem-medium',
    lang: 'ar',
    label: 'Kareem (Male · JO)',
    gender: 'male',
    shortName: 'Kareem',
    modelId: 'ar_JO-kareem-medium',
    hfPath: 'ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // French (France)
  {
    id: 'fr_FR-siwis-medium',
    lang: 'fr',
    label: 'Siwis (Female · FR)',
    gender: 'female',
    shortName: 'Siwis',
    modelId: 'fr_FR-siwis-medium',
    hfPath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'fr_FR-tom-medium',
    lang: 'fr',
    label: 'Tom (Male · FR)',
    gender: 'male',
    shortName: 'Tom',
    modelId: 'fr_FR-tom-medium',
    hfPath: 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'fr_FR-upmc-medium:0',
    lang: 'fr',
    label: 'Jessica (Female · FR)',
    gender: 'female',
    shortName: 'Jessica',
    modelId: 'fr_FR-upmc-medium',
    hfPath: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'fr_FR-upmc-medium:1',
    lang: 'fr',
    label: 'Pierre (Male · FR)',
    gender: 'male',
    shortName: 'Pierre',
    modelId: 'fr_FR-upmc-medium',
    hfPath: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
    speakerId: 1,
    useRhasspyRepo: true,
  },

  // Ukrainian
  {
    id: 'uk_UA-tetiana-high',
    lang: 'uk',
    label: 'Tetiana (Female · UA)',
    gender: 'female',
    shortName: 'Tetiana',
    modelId: 'uk_UA-tetiana-high',
    hfPath: 'uk/uk_UA/tetiana/high/uk_UA-tetiana-high.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'uk_UA-mykyta-high',
    lang: 'uk',
    label: 'Mykyta (Male · UA)',
    gender: 'male',
    shortName: 'Mykyta',
    modelId: 'uk_UA-mykyta-high',
    hfPath: 'uk/uk_UA/mykyta/high/uk_UA-mykyta-high.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'uk_UA-oleksa-high',
    lang: 'uk',
    label: 'Oleksa (Male · UA)',
    gender: 'male',
    shortName: 'Oleksa',
    modelId: 'uk_UA-oleksa-high',
    hfPath: 'uk/uk_UA/oleksa/high/uk_UA-oleksa-high.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Russian
  {
    id: 'ru_RU-irina-medium',
    lang: 'ru',
    label: 'Irina (Female · RU)',
    gender: 'female',
    shortName: 'Irina',
    modelId: 'ru_RU-irina-medium',
    hfPath: 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'ru_RU-dmitri-medium',
    lang: 'ru',
    label: 'Dmitri (Male · RU)',
    gender: 'male',
    shortName: 'Dmitri',
    modelId: 'ru_RU-dmitri-medium',
    hfPath: 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },

  // Dari, using Iranian Persian voices (fa_IR)
  {
    id: 'fa_IR-magnoliasis-medium',
    lang: 'prs',
    label: 'Magnoliasis (Female · IR)',
    gender: 'female',
    shortName: 'Magnoliasis',
    modelId: 'fa_IR-magnoliasis-medium',
    hfPath: 'fa/fa_IR/magnoliasis/medium/fa_IR-magnoliasis-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'fa_IR-amir-medium',
    lang: 'prs',
    label: 'Amir (Male · IR)',
    gender: 'male',
    shortName: 'Amir',
    modelId: 'fa_IR-amir-medium',
    hfPath: 'fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'fa_IR-ganji_adabi-medium',
    lang: 'prs',
    label: 'Ganji Adabi (Male · IR)',
    gender: 'male',
    shortName: 'Ganji Adabi',
    modelId: 'fa_IR-ganji_adabi-medium',
    hfPath: 'fa/fa_IR/ganji_adabi/medium/fa_IR-ganji_adabi-medium.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
];

export const DEFAULT_PIPER_VOICE_ID: Record<PiperLanguage, string> = {
  en: 'en_US-hfc_female-medium',
  es: 'es_MX-claude-high',
  pt: 'pt_BR-faber-medium',
  vi: 'vi_VN-vais1000-medium',
  hi: 'hi_IN-priyamvada-medium',
  bn: 'bn_BD-google-medium:0',
  ur: 'ur_PK-aegis_female-medium',
  id: 'id_ID-news_tts-medium',
  sw: 'sw_CD-lanfrica-medium',
  tr: 'tr_TR-dfki-medium',
  zh: 'zh_CN-xiao_ya-medium',
  ar: 'ar_JO-kareem-medium',
  fr: 'fr_FR-siwis-medium',
  uk: 'uk_UA-tetiana-high',
  ru: 'ru_RU-irina-medium',
  prs: 'fa_IR-magnoliasis-medium',
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
    case 'ar': {
      return {
        spoken: `مرحباً، أنا ${shortName}. هل أقرأ لك بالعربية؟`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Arabic for you?`,
      };
    }
    case 'fr': {
      return {
        spoken: `Bonjour, je suis ${shortName}. Voulez-vous que je vous lise en français ?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read French for you?`,
      };
    }
    case 'uk': {
      return {
        spoken: `Привіт, я ${shortName}. Прочитати вам українською?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Ukrainian for you?`,
      };
    }
    case 'ru': {
      return {
        spoken: `Здравствуйте, я ${shortName}. Прочитать вам по-русски?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Russian for you?`,
      };
    }
    case 'prs': {
      return {
        spoken: `سلام، من ${shortName} هستم. آیا برایتان فارسی بخوانم؟`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Dari for you?`,
      };
    }
    case 'zh': {
      return {
        spoken: `你好，我是${shortName}。要我为你朗读中文吗？`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Chinese for you?`,
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
