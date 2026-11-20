import { useCallback, useSyncExternalStore, type SetStateAction } from 'react';
import type { ConversationLanguage } from '../types';
import {
  CONVERSATION_SETTINGS_KEY,
  parseConversationSettings,
  type ConversationSettings,
} from './conversationSettings';

// One shared copy of the Two-way/Lecture settings. Every screen that reads them (Lecture, the
// main page's Settings, a lecture import) sees a change at once, and so do other tabs.
// The saved JSON is the source of truth: a screen re-reads it instead of keeping its own copy.

const listeners = new Set<() => void>();
// Once storage refuses a write, keep settings in memory for the rest of this page load.
let useMemory = false;
let memoryRaw: string | null = null;
let saved: { raw: string; value: ConversationSettings } | null = null;
// Before anything is saved, the defaults depend on the student language each caller passes.
const unsaved = new Map<ConversationLanguage, ConversationSettings>();

function readRaw(): string | null {
  if (useMemory) return memoryRaw;
  try {
    return localStorage.getItem(CONVERSATION_SETTINGS_KEY);
  } catch {
    useMemory = true;
    return memoryRaw;
  }
}

/** The current settings. Returns the same object until they change, as React requires. */
export function getConversationSettings(
  initialLanguage: ConversationLanguage = 'es',
): ConversationSettings {
  const raw = readRaw();
  if (raw === null) {
    let value = unsaved.get(initialLanguage);
    if (!value) {
      value = parseConversationSettings(null, initialLanguage);
      unsaved.set(initialLanguage, value);
    }
    return value;
  }
  if (saved?.raw !== raw) saved = { raw, value: parseConversationSettings(raw, initialLanguage) };
  return saved.value;
}

/** Change the settings, save them, and update every screen that shows them. */
export function updateConversationSettings(
  action: SetStateAction<ConversationSettings>,
  initialLanguage: ConversationLanguage = 'es',
): void {
  const current = getConversationSettings(initialLanguage);
  const next = typeof action === 'function' ? action(current) : action;
  if (next === current) return;
  const raw = JSON.stringify(next);
  memoryRaw = raw;
  if (!useMemory) {
    try {
      localStorage.setItem(CONVERSATION_SETTINGS_KEY, raw);
    } catch {
      useMemory = true;
    }
  }
  saved = { raw, value: next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab saved settings (key is null when it cleared storage)
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONVERSATION_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Like `useState` for the shared Two-way/Lecture settings. */
export function useConversationSettings(initialLanguage: ConversationLanguage = 'es') {
  const settings = useSyncExternalStore(subscribe, () => getConversationSettings(initialLanguage));
  const setSettings = useCallback(
    (action: SetStateAction<ConversationSettings>) => updateConversationSettings(action, initialLanguage),
    [initialLanguage],
  );
  return [settings, setSettings] as const;
}
