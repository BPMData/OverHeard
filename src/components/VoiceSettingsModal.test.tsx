// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSettingsModal } from './VoiceSettingsModal';
import type { SpeechClient } from '../tts/piperClient';
import { findPiperVoice, resolveVoiceId } from '../tts/voices';

function createMockClient(): {
  client: SpeechClient;
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  preloadVoice: ReturnType<typeof vi.fn>;
} {
  const stop = vi.fn();
  const speak = vi.fn(() => ({ pause: vi.fn(), resume: vi.fn(), stop }));
  const preloadVoice = vi.fn();
  const client: SpeechClient = {
    isPiperSupported: () => true,
    shouldUsePiper: () => true,
    preloadVoice,
    prefetch: vi.fn(),
    speak,
    subscribeStatus: () => () => undefined,
    unlockAudio: vi.fn(),
  };
  return { client, speak, stop, preloadVoice };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('VoiceSettingsModal', () => {
  it('saves default voices per language, speaks localized previews, and stops preview on close', () => {
    const { client, speak, stop, preloadVoice } = createMockClient();
    const onClose = vi.fn();

    render(<VoiceSettingsModal isOpen onClose={onClose} isDark client={client} />);

    // Change English default voice -> saves and plays English preview immediately
    fireEvent.change(screen.getByLabelText('Default English voice'), {
      target: { value: 'en_US-kristin-medium' },
    });
    expect(JSON.parse(localStorage.getItem('overheard.voices')!).en).toBe('en_US-kristin-medium');
    expect(preloadVoice).toHaveBeenCalledWith('en_US-kristin-medium');
    expect(speak).toHaveBeenCalledWith(
      "Hi, I'm Kristin. Should I be your reader for English?",
      expect.objectContaining({ lang: 'en', voiceId: 'en_US-kristin-medium' })
    );

    // Click Stop preview, then change Spanish and click Preview for Portuguese
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    expect(stop).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Default Spanish voice'), {
      target: { value: 'es_MX-ald-medium' },
    });
    expect(speak).toHaveBeenLastCalledWith(
      'Hola, soy Ald. ¿Debería ser tu lector de español?',
      expect.objectContaining({ lang: 'es', voiceId: 'es_MX-ald-medium' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview Portuguese voice' }));
    expect(speak).toHaveBeenLastCalledWith(
      'Olá, eu sou Faber. Devo ser o seu leitor de português?',
      expect.objectContaining({ lang: 'pt', voiceId: 'pt_BR-faber-medium' })
    );

    // Remounting preserves saved selections from localStorage
    cleanup();
    render(<VoiceSettingsModal isOpen onClose={onClose} client={client} />);
    expect((screen.getByLabelText('Default English voice') as HTMLSelectElement).value).toBe('en_US-kristin-medium');
    expect((screen.getByLabelText('Default Spanish voice') as HTMLSelectElement).value).toBe('es_MX-ald-medium');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the on-device privacy note only when asked, with no Gemini option', () => {
    const { client } = createMockClient();
    const { rerender } = render(<VoiceSettingsModal isOpen onClose={vi.fn()} isDark client={client} />);
    expect(screen.queryByText(/Zero-Cloud \/ On-Device Guarantee/i)).toBeNull();

    rerender(<VoiceSettingsModal isOpen onClose={vi.fn()} isDark client={client} showPrivacy />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText(/Zero-Cloud \/ On-Device Guarantee/i)).toBeTruthy();
    expect(screen.getByText(/none of your student or classroom data goes online/i)).toBeTruthy();
    expect(screen.queryByText(/Gemini/i)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Refine statements/i })).toBeNull();
  });
  it('saves one voice for offline only when asked, then marks it saved', async () => {
    const { client } = createMockClient();
    const saved = new Set<string>();
    const saveForOffline = vi.fn(async (voiceId: string) => {
      saved.add(findPiperVoice(voiceId)!.modelId);
    });
    const listSavedModels = vi.fn(async () => [...saved]);
    render(<VoiceSettingsModal isOpen onClose={vi.fn()} client={{ ...client, saveForOffline, listSavedModels }} />);
    const saveSpanish = await screen.findByRole('button', { name: 'Save Spanish voice for offline' });
    // Opening the settings downloads nothing
    expect(saveForOffline).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).toBeNull();

    fireEvent.click(saveSpanish);
    await screen.findByText('Saved');
    // Only the voice asked for, not every language's
    expect(saveForOffline).toHaveBeenCalledTimes(1);
    expect(saveForOffline).toHaveBeenCalledWith(resolveVoiceId('es'));
    expect(screen.queryByRole('button', { name: 'Save Spanish voice for offline' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save English voice for offline' })).toBeTruthy();
  });

  it('reports a voice that could not be saved', async () => {
    const { client } = createMockClient();
    const saveForOffline = vi.fn(async () => {
      throw new Error('offline');
    });
    render(
      <VoiceSettingsModal
        isOpen
        onClose={vi.fn()}
        client={{ ...client, saveForOffline, listSavedModels: async () => [] }}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save English voice for offline' }));
    await screen.findByText(/Could not save this voice/);
  });
});

describe('VoiceSettingsModal download sizes', () => {
  it('shows each voice size before download and the space used section', async () => {
    const { client } = createMockClient();
    render(
      <VoiceSettingsModal
        isOpen
        onClose={vi.fn()}
        client={{ ...client, saveForOffline: vi.fn(), listSavedModels: async () => ['en_US-hfc_female-medium'] }}
        storageCategories={[]}
      />
    );
    const save = await screen.findByRole('button', { name: 'Save Spanish voice for offline' });
    expect(save.textContent).toBe('Save offline (60 MB)');
    const spanish = screen.getByLabelText('Default Spanish voice') as HTMLSelectElement;
    expect([...spanish.options].map((o) => o.textContent)).toContain('Claude (Female · MX) — 60 MB');
    // A voice already on this device says so instead of a size
    const english = screen.getByLabelText('Default English voice') as HTMLSelectElement;
    expect([...english.options].map((o) => o.textContent)).toContain('HFC Female (Female · US) — saved');
    expect(screen.getByRole('heading', { name: 'Space used on this device' })).toBeTruthy();
  });
});
