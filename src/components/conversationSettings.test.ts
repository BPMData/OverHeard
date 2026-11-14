// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationCsv,
  loadConversationSettings,
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
    saveConversationSettings(settings);
    expect(loadConversationSettings()).toEqual(settings);
  });
  it('survives blocked storage and validates stored settings', () => {
    localStorage.setItem(
      'overheard.conversation',
      JSON.stringify({ a: { lang: 'xx' }, switchAfterMs: 42, placement: 'anything' }),
    );
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
  it('exports BOM, quoted names, commas, quotes and embedded newlines', () => {
    const participants = {
      a: { name: 'Me, "teacher"', lang: 'en' as const },
      b: { name: 'Student', lang: 'es' as const },
    };
    const message = createMessage('a', 'Hello\n"friend"', participants);
    message.translated = 'Hola, amigo';
    const csv = conversationCsv([message]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Me, ""teacher"""');
    expect(csv).toContain('"Hello\n""friend"""');
    expect(csv).toContain('"Hola, amigo"');
  });
});
