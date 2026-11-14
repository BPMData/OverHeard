// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMode } from './ConversationMode';

class Recognition {
  static available = vi.fn(async () => 'downloadable');
  static install = vi.fn(async () => true);
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally?: boolean;
  onresult = null;
  onerror = null;
  onend = null;
  start = vi.fn();
  abort = vi.fn();
}
const translator = {
  availability: vi.fn(async () => 'downloadable'),
  create: vi.fn(() => new Promise(() => {})),
};

beforeEach(() => {
  localStorage.clear();
  Recognition.available.mockClear();
  Recognition.install.mockClear();
  translator.availability.mockClear();
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('Translator', translator);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(mtPreference: string, onPackProgress = vi.fn()) {
  render(
    <ConversationMode
      active
      fontSize={32}
      isDark
      translate={vi.fn(async (text: string) => text)}
      mtPreference={mtPreference}
      onExit={vi.fn()}
      onPermissionDenied={vi.fn()}
      onPackProgress={onPackProgress}
      packPanel={<div data-testid="packs" />}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  return { onPackProgress };
}

describe('conversation with On this device', () => {
  it('downloads every pack both people need from the Start click', async () => {
    const { onPackProgress } = mount('on-device');
    // English ↔ Spanish by default: two speech packs and both translation directions,
    // all started by this one click (the hand-off to the other speaker isn't a click).
    await vi.waitFor(() => expect(Recognition.install).toHaveBeenCalledTimes(2));
    expect(Recognition.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    expect(Recognition.install).toHaveBeenCalledWith({ langs: ['es-US'], processLocally: true });
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'es',
      targetLanguage: 'en',
    });
    expect(onPackProgress).toHaveBeenCalledWith('speech:es', -1);
    expect(screen.getByTestId('packs')).toBeTruthy();
  });

  it('Auto fetches only the translation packs and leaves speech on the online service', async () => {
    // French, not the default Spanish: the previous test left Spanish translators cached
    localStorage.setItem(
      'overheard.conversation',
      JSON.stringify({ a: { name: 'Me', lang: 'en' }, b: { name: 'Student', lang: 'fr' } }),
    );
    mount('auto');
    await vi.waitFor(() => expect(translator.availability).toHaveBeenCalledTimes(2));
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    });
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'fr',
      targetLanguage: 'en',
    });
    expect(Recognition.install).not.toHaveBeenCalled();
  });

  it('downloads nothing when an online translator is chosen', async () => {
    mount('gtx');
    await Promise.resolve();
    expect(Recognition.install).not.toHaveBeenCalled();
    expect(translator.availability).not.toHaveBeenCalled();
  });
});
