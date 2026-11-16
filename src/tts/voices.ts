import type { ConversationLanguage } from '../types';

export type PiperLanguage = 'en' | 'es' | 'pt';

export interface PiperVoiceOption {
  id: string;
  lang: PiperLanguage;
  label: string;
  modelId: string;
  hfPath: string;
  speakerId: number;
  useRhasspyRepo?: boolean;
}

export const BROWSER_VOICE_ID = 'browser';
export const BROWSER_VOICE_LABEL = 'System / Browser voice';
export const VOICE_PREFS_STORAGE_KEY = 'overheard.voices';

export const PIPER_VOICES: readonly PiperVoiceOption[] = [
  // Spanish (Mexico)
  {
    id: 'es_MX-claude-high',
    lang: 'es',
    label: 'Claude (Female · MX)',
    modelId: 'es_MX-claude-high',
    hfPath: 'es/es_MX/claude/high/es_MX-claude-high.onnx',
    speakerId: 0,
  },
  {
    id: 'es_MX-ald-medium',
    lang: 'es',
    label: 'Ald (Male · MX)',
    modelId: 'es_MX-ald-medium',
    hfPath: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx',
    speakerId: 0,
  },

  // Portuguese (Brazil)
  {
    id: 'pt_BR-faber-medium',
    lang: 'pt',
    label: 'Faber (Male · BR)',
    modelId: 'pt_BR-faber-medium',
    hfPath: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'pt_BR-cadu-medium',
    lang: 'pt',
    label: 'Cadu (Male · BR)',
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
    modelId: 'en_US-hfc_female-medium',
    hfPath: 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-kristin-medium',
    lang: 'en',
    label: 'Kristin (Female · US)',
    modelId: 'en_US-kristin-medium',
    hfPath: 'en/en_US/kristin/medium/en_US-kristin-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-kusal-medium',
    lang: 'en',
    label: 'Kusal (Male · US)',
    modelId: 'en_US-kusal-medium',
    hfPath: 'en/en_US/kusal/medium/en_US-kusal-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-ryan-high',
    lang: 'en',
    label: 'Ryan (Male · US)',
    modelId: 'en_US-ryan-high',
    hfPath: 'en/en_US/ryan/high/en_US-ryan-high.onnx',
    speakerId: 0,
  },
  {
    id: 'en_US-hifi_tts-low:0',
    lang: 'en',
    label: 'HiFi 92 · Cori (Female · UK/US)',
    modelId: 'en_US-hifi_tts-low',
    hfPath: 'en/en_US/hifi_tts/low/en_US-hifi_tts-low.onnx',
    speakerId: 0,
    useRhasspyRepo: true,
  },
  {
    id: 'en_GB-alba-medium',
    lang: 'en',
    label: 'Alba (Female · UK)',
    modelId: 'en_GB-alba-medium',
    hfPath: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-northern_english_male-medium',
    lang: 'en',
    label: 'Northern English (Male · UK)',
    modelId: 'en_GB-northern_english_male-medium',
    hfPath: 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-semaine-medium:0',
    lang: 'en',
    label: 'Semaine · Prudence (Female · UK)',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 0,
  },
  {
    id: 'en_GB-semaine-medium:3',
    lang: 'en',
    label: 'Semaine · Poppy (Female · UK)',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 3,
  },
  {
    id: 'en_GB-semaine-medium:1',
    lang: 'en',
    label: 'Semaine · Spike (Male · UK)',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 1,
  },
  {
    id: 'en_GB-semaine-medium:2',
    lang: 'en',
    label: 'Semaine · Obadiah (Male · UK)',
    modelId: 'en_GB-semaine-medium',
    hfPath: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    speakerId: 2,
  },
];

export const DEFAULT_PIPER_VOICE_ID: Record<PiperLanguage, string> = {
  en: 'en_US-hfc_female-medium',
  es: 'es_MX-claude-high',
  pt: 'pt_BR-faber-medium',
};

const VOICE_MAP = new Map<string, PiperVoiceOption>(PIPER_VOICES.map((v) => [v.id, v]));

export type VoicePreferences = Partial<Record<ConversationLanguage, string>>;

export function hasPiperVoices(lang: ConversationLanguage): lang is PiperLanguage {
  return lang === 'en' || lang === 'es' || lang === 'pt';
}

export function voicesForLanguage(lang: ConversationLanguage): PiperVoiceOption[] {
  if (!hasPiperVoices(lang)) return [];
  return PIPER_VOICES.filter((voice) => voice.lang === lang);
}

export function findPiperVoice(id: string | null | undefined): PiperVoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_MAP.get(id);
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
  } catch {
    /* Storage may be unavailable. */
  }
}
