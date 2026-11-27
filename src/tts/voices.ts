import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationLanguage } from '../types';

import {
  BROWSER_VOICE_ID,
  DEFAULT_PIPER_VOICE_ID,
  PIPER_DEFAULT_MODEL_BYTES,
  PIPER_MODEL_BYTES,
  PIPER_VOICES,
  VOICE_PREFS_EVENT,
  VOICE_PREFS_STORAGE_KEY,
} from './voiceCatalog';
import type { PiperLanguage, PiperVoiceOption } from './voiceCatalog';
export * from './voiceCatalog';

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

export function voicePreviewText(lang: PiperLanguage, voiceId: string): { spoken: string; englishHint: string } {
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
    case 'ht': {
      return {
        spoken: `Bonjou, mwen se ${shortName}. Èske m ka li kreyòl ayisyen pou ou?`,
        englishHint: `Hi, I'm ${shortName}. Can I read Haitian Creole for you?`,
      };
    }
    case 'so': {
      return {
        spoken: `Salaan, waxaan ahay ${shortName}. Ma kuu akhriyaa af Soomaali?`,
        englishHint: `Hi, I'm ${shortName}. Shall I read Somali for you?`,
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

export function useVoicePreferences(): [VoicePreferences, (lang: ConversationLanguage, voiceId: string) => void] {
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

/** Approximate download size of a voice's model in bytes, or 0 for the browser voice. */
export function voiceDownloadBytes(voiceId: string): number {
  const voice = findPiperVoice(voiceId);
  if (!voice) return 0;
  if (voice.downloadBytes) return voice.downloadBytes;
  return PIPER_MODEL_BYTES[voice.modelId] ?? PIPER_DEFAULT_MODEL_BYTES;
}

/** "63 MB" style size for a voice picker, or '' for the browser voice. */
export function voiceDownloadLabel(voiceId: string): string {
  const bytes = voiceDownloadBytes(voiceId);
  return bytes ? `${Math.round(bytes / (1024 * 1024))} MB` : '';
}
