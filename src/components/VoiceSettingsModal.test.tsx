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
      expect.objectContaining({ lang: 'en', voiceId: 'en_US-kristin-medium' }),
    );

    // Click Stop preview, then change Spanish and click Preview for Portuguese
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    expect(stop).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Default Spanish voice'), {
      target: { value: 'es_MX-ald-medium' },
    });
    expect(speak).toHaveBeenLastCalledWith(
      'Hola, soy Ald. ¿Debería ser tu lector de español?',
      expect.objectContaining({ lang: 'es', voiceId: 'es_MX-ald-medium' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview Portuguese voice' }));
    expect(speak).toHaveBeenLastCalledWith(
      'Olá, eu sou Faber. Devo ser o seu leitor de português?',
      expect.objectContaining({ lang: 'pt', voiceId: 'pt_BR-faber-medium' }),
    );

    // Remounting preserves saved selections from localStorage
    cleanup();
    render(<VoiceSettingsModal isOpen onClose={onClose} client={client} />);
    expect((screen.getByLabelText('Default English voice') as HTMLSelectElement).value).toBe(
      'en_US-kristin-medium',
    );
    expect((screen.getByLabelText('Default Spanish voice') as HTMLSelectElement).value).toBe(
      'es_MX-ald-medium',
    );

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
  it('saves the chosen voices for offline only when asked, then marks them saved', async () => {
    const { client } = createMockClient();
    const saved = new Set<string>();
    const saveForOffline = vi.fn(async (voiceId: string) => {
      saved.add(findPiperVoice(voiceId)!.modelId);
    });
    const listSavedModels = vi.fn(async () => [...saved]);
    render(
      <VoiceSettingsModal isOpen onClose={vi.fn()} client={{ ...client, saveForOffline, listSavedModels }} />,
    );
    await waitFor(() => expect(listSavedModels).toHaveBeenCalled());
    // Opening the settings downloads nothing
    expect(saveForOffline).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save chosen voices for offline' }));
    await screen.findByText('Saved. These voices will read aloud without an internet connection.');
    const chosen = new Set(['en', 'es', 'pt'].map((lang) => resolveVoiceId(lang as 'en')));
    expect(saveForOffline).toHaveBeenCalledTimes(chosen.size);
    for (const voiceId of chosen) expect(saveForOffline).toHaveBeenCalledWith(voiceId);
    expect(screen.getAllByText('Saved')).toHaveLength(3);
  });

  it('reports voices that could not be saved', async () => {
    const { client } = createMockClient();
    const saveForOffline = vi.fn(async () => {
      throw new Error('offline');
    });
    render(
      <VoiceSettingsModal
        isOpen
        onClose={vi.fn()}
        client={{ ...client, saveForOffline, listSavedModels: async () => [] }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save chosen voices for offline' }));
    await screen.findByText(/could not be saved/);
  });
});
