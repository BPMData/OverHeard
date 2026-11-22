// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMode } from './ConversationMode';

class Recognition {
  static available = vi.fn(async () => 'downloadable');
  static install = vi.fn(async () => true);
  static instances: Recognition[] = [];
  constructor() {
    Recognition.instances.push(this);
  }
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
  Recognition.instances = [];
  translator.availability.mockClear();
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('Translator', translator);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('Auto leaves the click to translation packs while any still need downloading', async () => {
    // French, not the default Spanish: the previous test left Spanish translators cached
    localStorage.setItem(
      'overheard.conversation',
      JSON.stringify({ a: { name: 'Me', lang: 'en' }, b: { name: 'Student', lang: 'fr' } }),
    );
    mount('auto');
    await vi.waitFor(() => expect(translator.availability).toHaveBeenCalledTimes(4));
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    });
    expect(translator.availability).toHaveBeenCalledWith({
      sourceLanguage: 'fr',
      targetLanguage: 'en',
    });
    // Chrome allows one pack download per click; a speech install could take it
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(Recognition.install).not.toHaveBeenCalled();
  });

  it('Auto fetches speech packs for offline use once translation is ready', async () => {
    translator.availability.mockResolvedValue('available');
    localStorage.setItem(
      'overheard.conversation',
      JSON.stringify({ a: { name: 'Me', lang: 'en' }, b: { name: 'Student', lang: 'fr' } }),
    );
    mount('auto');
    await vi.waitFor(() =>
      expect(Recognition.install).toHaveBeenCalledWith({ langs: ['fr-FR'], processLocally: true }),
    );
    expect(Recognition.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    translator.availability.mockResolvedValue('downloadable');
  });

  it('Auto runs speech on this device while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount('auto');
    await vi.waitFor(() => expect(Recognition.instances.at(-1)?.start).toHaveBeenCalled());
    expect(Recognition.instances.at(-1)?.processLocally).toBe(true);
  });

  it('Auto keeps speech on the online service while connected', async () => {
    mount('auto');
    await vi.waitFor(() => expect(Recognition.instances.at(-1)?.start).toHaveBeenCalled());
    expect(Recognition.instances.at(-1)?.processLocally).toBe(false);
  });

  it('downloads nothing when an online translator is chosen', async () => {
    mount('gtx');
    await Promise.resolve();
    expect(Recognition.install).not.toHaveBeenCalled();
    expect(translator.availability).not.toHaveBeenCalled();
  });
});

describe('languages "Only on this device" cannot translate', () => {
  beforeEach(() => {
    translator.availability.mockImplementation(async (pair?: { sourceLanguage: string; targetLanguage: string }) =>
      pair && [pair.sourceLanguage, pair.targetLanguage].some((l) => l === 'ht' || l === 'ps') ? 'unavailable' : 'available');
  });
  afterEach(() => translator.availability.mockImplementation(async () => 'downloadable'));

  function show(props: Partial<React.ComponentProps<typeof ConversationMode>>) {
    render(
      <ConversationMode
        active
        fontSize={32}
        isDark
        translate={vi.fn(async (text: string) => text)}
        mtPreference="on-device"
        onExit={vi.fn()}
        onPermissionDenied={vi.fn()}
        {...props}
      />,
    );
  }

  it('names them in two-way mode', async () => {
    show({ initialLanguage: 'ps' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('⚠ Pashto: “Only on this device” can’t translate this language');
  });

  it('names them in lecture mode, and only them', async () => {
    show({ selectedLangs: ['ht', 'es'], onOpenLanguages: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('⚠ Haitian Creole: “Only on this device” can’t translate this language');
    expect(alert.textContent).not.toContain('Spanish');
  });

  it('says nothing with On-device first, which uses online translation for them', async () => {
    show({ initialLanguage: 'ps', mtPreference: 'auto' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
