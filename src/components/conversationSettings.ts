import { SUPPORTED_LANGUAGES } from '../constants';
import type { ConversationLanguage } from '../types';
import {
  createImportedMessage,
  otherSide,
  type Message,
  type Participants,
  type Side,
} from '../conversation/state';
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
    if ([1000, 1500, 2500, 3500, 5000].includes(saved.switchAfterMs))
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
const CSV_HEADER = [
  'timestamp',
  'sender name',
  'original language',
  'original text',
  'translated language',
  'translated text',
];
export function conversationCsv(messages: Message[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      CSV_HEADER,
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
function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new Error('Invalid CSV file: unclosed quoted field.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}
export function parseConversationCsv(csv: string, participants: Participants): Message[] {
  const rows = parseCsvRows(csv);
  if (!rows.length) throw new Error('CSV file is empty.');
  const header = rows[0].map((c) => c.trim().toLowerCase());
  if (header.length < CSV_HEADER.length || CSV_HEADER.some((col, i) => header[i] !== col)) {
    throw new Error('Invalid conversation CSV header.');
  }
  const messages: Message[] = [];
  for (const row of rows.slice(1)) {
    const [
      rawTimestamp = '',
      rawSenderName = '',
      rawOrigLang = '',
      rawOrigText = '',
      rawTransLang = '',
      rawTransText = '',
    ] = row;
    const original = rawOrigText.trim();
    if (!original) continue;
    const senderName = rawSenderName.trim();
    const senderLang = validLanguage(rawOrigLang.trim())
      ? (rawOrigLang.trim() as ConversationLanguage)
      : participants.a.lang;
    const readerLang = validLanguage(rawTransLang.trim())
      ? (rawTransLang.trim() as ConversationLanguage)
      : participants.b.lang;
    const side: Side =
      senderName && senderName === participants.b.name && senderName !== participants.a.name
        ? 'b'
        : senderName && senderName === participants.a.name && senderName !== participants.b.name
          ? 'a'
          : senderLang === participants.b.lang && senderLang !== participants.a.lang
            ? 'b'
            : 'a';
    const parsedTime = Date.parse(rawTimestamp.trim());
    const timestamp = Number.isFinite(parsedTime) ? parsedTime : Date.now();
    messages.push(
      createImportedMessage({
        side,
        sender: { name: senderName || participants[side].name, lang: senderLang },
        reader: { name: participants[otherSide(side)].name, lang: readerLang },
        original,
        translated: rawTransText.trim(),
        timestamp,
      }),
    );
  }
  return messages;
}
