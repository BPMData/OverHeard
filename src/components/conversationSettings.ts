import { SUPPORTED_LANGUAGES } from '../constants';
import type { ConversationLanguage } from '../types';
import {
  createImportedMessage,
  otherSide,
  type Message,
  type Participants,
  type Side,
} from '../conversation/state';
export type ConversationSubMode = 'two-way' | 'lecture';
export interface ConversationSettings extends Participants {
  mode: ConversationSubMode;
  manualTurns: boolean;
  switchAfterMs: number;
  readAloud: boolean;
  placement: 'speaker' | 'reader';
  /**
   * Lecture: read the translation aloud while the teacher is still talking. The microphone
   * keeps listening while it reads, so this needs headphones. Off: the teacher laptop reads
   * finished lines and pauses the microphone. Student devices always read live.
   */
  lectureLiveReadAloud: boolean;
}
const validLanguage = (value: unknown): value is ConversationLanguage =>
  value === 'en' || SUPPORTED_LANGUAGES.some((l) => l.code === value);
export function loadConversationSettings(
  initialLanguage: ConversationLanguage = 'es',
): ConversationSettings {
  const defaults: ConversationSettings = {
    mode: 'two-way',
    a: { name: 'Me', lang: 'en' },
    b: { name: 'Student', lang: initialLanguage },
    manualTurns: false,
    switchAfterMs: 2500,
    readAloud: false,
    placement: 'speaker',
    lectureLiveReadAloud: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('overheard.conversation') || 'null');
    if (!saved) return defaults;
    defaults.mode = saved.mode === 'lecture' ? 'lecture' : 'two-way';
    for (const side of ['a', 'b'] as const) {
      if (typeof saved[side]?.name === 'string') defaults[side].name = saved[side].name;
      if (validLanguage(saved[side]?.lang)) defaults[side].lang = saved[side].lang;
    }
    if ([1000, 1500, 2500, 3500, 5000].includes(saved.switchAfterMs))
      defaults.switchAfterMs = saved.switchAfterMs;
    defaults.manualTurns = saved.manualTurns === true;
    defaults.readAloud = saved.readAloud === true;
    defaults.placement = saved.placement === 'reader' ? 'reader' : 'speaker';
    defaults.lectureLiveReadAloud = saved.lectureLiveReadAloud === true;
  } catch {
    /* Storage may be unavailable. */
  }
  return defaults;
}
export function saveConversationSettings(settings: ConversationSettings) {
  try {
    localStorage.setItem('overheard.conversation', JSON.stringify(settings));
  } catch {
    /* Keep the session usable. */
  }
}
export function conversationJson(messages: Message[], participants?: Participants): string {
  return JSON.stringify(
    {
      format: 'overheard-conversation',
      version: 1,
      exportedAt: new Date().toISOString(),
      ...(participants ? { participants } : {}),
      messages: messages.map((m) => ({
        timestamp: m.timestamp,
        side: m.side,
        sender: m.sender,
        reader: m.reader,
        original: m.original,
        translated: m.translated,
        status: m.status,
      })),
    },
    null,
    2,
  );
}

export function parseConversationJson(text: string, participants: Participants): Message[] {
  if (!text.trim()) throw new Error('JSON file is empty.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Choose an OverHeard conversation JSON file (version 1).');
  }
  const input = parsed as Record<string, unknown>;
  if (
    input.format !== 'overheard-conversation' ||
    input.version !== 1 ||
    !Array.isArray(input.messages)
  ) {
    throw new Error('Choose an OverHeard conversation JSON file (version 1).');
  }

  const messages: Message[] = [];
  for (const raw of input.messages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const original = typeof item.original === 'string' ? item.original.trim() : '';
    if (!original) continue;

    const rawSender =
      item.sender && typeof item.sender === 'object' && !Array.isArray(item.sender)
        ? (item.sender as Record<string, unknown>)
        : {};
    const rawReader =
      item.reader && typeof item.reader === 'object' && !Array.isArray(item.reader)
        ? (item.reader as Record<string, unknown>)
        : {};

    const senderName = typeof rawSender.name === 'string' ? rawSender.name.trim() : '';
    const senderLang = validLanguage(rawSender.lang)
      ? rawSender.lang
      : participants.a.lang;
    const readerLang = validLanguage(rawReader.lang)
      ? rawReader.lang
      : participants.b.lang;

    const explicitSide: Side | null = item.side === 'a' || item.side === 'b' ? item.side : null;
    const side: Side =
      explicitSide ??
      (senderName && senderName === participants.b.name && senderName !== participants.a.name
        ? 'b'
        : senderName && senderName === participants.a.name && senderName !== participants.b.name
          ? 'a'
          : senderLang === participants.b.lang && senderLang !== participants.a.lang
            ? 'b'
            : 'a');

    const readerName =
      typeof rawReader.name === 'string' && rawReader.name.trim()
        ? rawReader.name.trim()
        : participants[otherSide(side)].name;

    const rawTimestamp = item.timestamp;
    const parsedTime =
      typeof rawTimestamp === 'number'
        ? rawTimestamp
        : typeof rawTimestamp === 'string'
          ? Date.parse(rawTimestamp)
          : NaN;
    const timestamp =
      Number.isFinite(parsedTime) && Math.abs(parsedTime) <= 8.64e15 ? parsedTime : Date.now();

    const translated = typeof item.translated === 'string' ? item.translated.trim() : '';
    const status =
      item.status === 'done' || item.status === 'translating' || item.status === 'error'
        ? item.status
        : undefined;

    messages.push(
      createImportedMessage({
        side,
        sender: { name: senderName || participants[side].name, lang: senderLang },
        reader: { name: readerName, lang: readerLang },
        original,
        translated,
        status,
        timestamp,
      }),
    );
  }
  return messages;
}
