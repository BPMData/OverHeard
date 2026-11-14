import { describe, expect, it } from 'vitest';
import { correctMessage, createMessage, messagesReducer, type Participants } from './state';

const people: Participants = { a: { name: 'Me', lang: 'en' }, b: { name: 'Student', lang: 'es' } };

describe('conversation messages', () => {
  it('snapshots participants and queues a bilingual message', () => {
    const message = createMessage('b', ' hola ', people);
    expect(message).toMatchObject({
      side: 'b',
      original: 'hola',
      sender: people.b,
      reader: people.a,
      status: 'translating',
    });
    expect(message.sender).not.toBe(people.b);
    expect(messagesReducer([], { type: 'add', message })).toEqual([message]);
  });

  it('ignores empty sends and completes same-language captions immediately', () => {
    expect(messagesReducer([], { type: 'add', message: createMessage('a', ' ', people) })).toEqual(
      [],
    );
    const message = createMessage('a', 'Hello', { ...people, b: { name: 'Grandpa', lang: 'en' } });
    expect(message).toMatchObject({ translated: 'Hello', status: 'done' });
  });

  it('corrects the speaker and ignores replies for a previous direction or cleared thread', () => {
    const message = createMessage('a', 'Hola', people);
    const corrected = correctMessage(message);
    const messages = messagesReducer([message], { type: 'correct', message: corrected });
    expect(corrected).toMatchObject({
      side: 'b',
      sender: people.b,
      reader: people.a,
      original: 'Hola',
    });
    const reply = {
      type: 'resolve' as const,
      id: message.id,
      revision: message.revision,
      translated: 'stale',
    };
    expect(messagesReducer(messages, reply)).toEqual(messages);
    expect(
      messagesReducer(messages, { ...reply, revision: corrected.revision, translated: 'Hello' })[0],
    ).toMatchObject({ status: 'done', translated: 'Hello' });
    expect(messagesReducer(messagesReducer(messages, { type: 'clear' }), reply)).toEqual([]);
  });
});
