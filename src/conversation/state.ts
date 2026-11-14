import type { ConversationLanguage, TranslationStatus } from '../types';

export type Side = 'a' | 'b';
export interface Participant {
  name: string;
  lang: ConversationLanguage;
}
export type Participants = Record<Side, Participant>;

export interface Message {
  id: string;
  revision: number;
  side: Side;
  sender: Participant;
  reader: Participant;
  original: string;
  translated: string;
  status: TranslationStatus;
  timestamp: number;
}

export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a');

function translationState(text: string, sender: Participant, reader: Participant) {
  const sameLanguage = sender.lang === reader.lang;
  return {
    translated: sameLanguage ? text : '',
    status: (sameLanguage ? 'done' : 'translating') as TranslationStatus,
  };
}

let nextId = 0;
export function createMessage(side: Side, text: string, participants: Participants): Message {
  const sender = { ...participants[side] };
  const reader = { ...participants[otherSide(side)] };
  const original = text.trim();
  return {
    id: String(++nextId),
    revision: 0,
    side,
    sender,
    reader,
    original,
    timestamp: Date.now(),
    ...translationState(original, sender, reader),
  };
}

export function correctMessage(message: Message): Message {
  const { sender, reader, original } = message;
  return {
    ...message,
    revision: message.revision + 1,
    side: otherSide(message.side),
    sender: reader,
    reader: sender,
    ...translationState(original, reader, sender),
  };
}

export function createImportedMessage(
  message: Omit<Message, 'id' | 'revision' | 'status'> & { status?: TranslationStatus },
): Message {
  const original = message.original.trim();
  const fallbackState = translationState(original, message.sender, message.reader);
  const translated = message.translated.trim() || fallbackState.translated;
  const status = message.status ?? (translated ? 'done' : fallbackState.status);
  return {
    ...message,
    id: String(++nextId),
    revision: 0,
    original,
    translated,
    status,
  };
}

type MessageAction =
  | { type: 'add' | 'correct'; message: Message }
  | { type: 'import'; messages: Message[] }
  | { type: 'resolve'; id: string; revision: number; translated: string | null }
  | { type: 'clear' };

export function messagesReducer(messages: Message[], action: MessageAction): Message[] {
  switch (action.type) {
    case 'clear':
      return [];
    case 'add':
      return action.message.original ? [...messages, action.message] : messages;
    case 'import':
      return [...messages, ...action.messages.filter((m) => m.original)];
    case 'correct':
      return messages.map((m) => (m.id === action.message.id ? action.message : m));
    case 'resolve':
      return messages.map((m) =>
        m.id === action.id && m.revision === action.revision
          ? {
              ...m,
              translated: action.translated ?? '',
              status: action.translated === null ? 'error' : 'done',
            }
          : m,
      );
  }
}
