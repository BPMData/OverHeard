// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationJson,
  loadConversationSettings,
  parseConversationJson,
  saveConversationSettings,
} from './conversationSettings';
import { createMessage } from '../conversation/state';
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('conversation settings', () => {
  it('uses the selected student language and restores all preferences', () => {
    expect(loadConversationSettings('ar').b.lang).toBe('ar');
    const settings = loadConversationSettings();
    settings.a.name = 'Bryan';
    settings.b = { name: 'Grandpa', lang: 'en' };
    settings.switchAfterMs = 5000;
    settings.readAloud = true;
    settings.placement = 'reader';
    expect(settings.layout).toBe('side-by-side');
    settings.layout = 'face-to-face';
    // Reading while the teacher talks is off until chosen, then remembered
    expect(settings.lectureLiveReadAloud).toBe(false);
    settings.lectureLiveReadAloud = true;
    saveConversationSettings(settings);
    expect(loadConversationSettings()).toEqual(settings);
  });
  it('survives blocked storage and validates stored settings', () => {
    localStorage.setItem(
      'overheard.conversation',
      JSON.stringify({ a: { lang: 'xx' }, switchAfterMs: 42, placement: 'anything', layout: 'up' }),
    );
    expect(loadConversationSettings().layout).toBe('side-by-side');
    expect(loadConversationSettings().a.lang).toBe('en');
    expect(loadConversationSettings().switchAfterMs).toBe(2500);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveConversationSettings(loadConversationSettings())).not.toThrow();
  });
  it('exports and imports conversation JSON with names, quotes, newlines, and sides preserved', () => {
    const participants = {
      a: { name: 'Me, "teacher"', lang: 'en' as const },
      b: { name: 'Student', lang: 'es' as const },
    };
    const message = createMessage('a', 'Hello\n"friend"', participants);
    message.translated = 'Hola, amigo';
    message.status = 'done';
    const reply = createMessage('b', '¡Hola!', participants);
    reply.translated = 'Hi!';
    reply.status = 'done';

    const json = conversationJson([message, reply], participants);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('overheard-conversation');
    expect(parsed.version).toBe(1);
    expect(parsed.messages).toHaveLength(2);

    const imported = parseConversationJson(json, participants);
    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({
      side: 'a',
      sender: participants.a,
      reader: participants.b,
      original: 'Hello\n"friend"',
      translated: 'Hola, amigo',
      status: 'done',
      timestamp: message.timestamp,
    });
    expect(imported[1]).toMatchObject({
      side: 'b',
      sender: participants.b,
      reader: participants.a,
      original: '¡Hola!',
      translated: 'Hi!',
      status: 'done',
      timestamp: reply.timestamp,
    });
    expect(() => parseConversationJson('{"wrong":true}', participants)).toThrow(
      'Choose an OverHeard conversation JSON file (version 1).',
    );
  });
});
