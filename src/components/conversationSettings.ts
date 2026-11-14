import { SUPPORTED_LANGUAGES } from '../constants';
import type { ConversationLanguage } from '../types';
import type { Message, Participants } from '../conversation/state';
export interface ConversationSettings extends Participants {
  manualTurns: boolean;
  switchAfterMs: number;
  readAloud: boolean;
  placement: 'speaker' | 'reader';
}
const validLanguage = (value: unknown): value is ConversationLanguage =>
  value === 'en' || SUPPORTED_LANGUAGES.some((l) => l.code === value);
export function loadConversationSettings(
  initialLanguage: ConversationLanguage = 'es',
): ConversationSettings {
  const defaults: ConversationSettings = {
    a: { name: 'Me', lang: 'en' },
    b: { name: 'Student', lang: initialLanguage },
    manualTurns: false,
    switchAfterMs: 2500,
    readAloud: false,
    placement: 'speaker',
  };
  try {
    const saved = JSON.parse(localStorage.getItem('overheard.conversation') || 'null');
    if (!saved) return defaults;
    for (const side of ['a', 'b'] as const) {
      if (typeof saved[side]?.name === 'string') defaults[side].name = saved[side].name;
      if (validLanguage(saved[side]?.lang)) defaults[side].lang = saved[side].lang;
    }
    if ([1500, 2500, 3500, 5000].includes(saved.switchAfterMs))
      defaults.switchAfterMs = saved.switchAfterMs;
    defaults.manualTurns = saved.manualTurns === true;
    defaults.readAloud = saved.readAloud === true;
    defaults.placement = saved.placement === 'reader' ? 'reader' : 'speaker';
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
export function conversationCsv(messages: Message[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      [
        'timestamp',
        'sender name',
        'original language',
        'original text',
        'translated language',
        'translated text',
      ],
      ...messages.map((m) => [
        new Date(m.timestamp).toISOString(),
        m.sender.name,
        m.sender.lang,
        m.original,
        m.reader.lang,
        m.translated,
      ]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
  );
}
