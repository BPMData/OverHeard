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

type MessageAction =
  | { type: 'add' | 'correct'; message: Message }
  | { type: 'resolve'; id: string; revision: number; translated: string | null }
  | { type: 'clear' };

export function messagesReducer(messages: Message[], action: MessageAction): Message[] {
  switch (action.type) {
    case 'clear':
      return [];
    case 'add':
      return action.message.original ? [...messages, action.message] : messages;
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
