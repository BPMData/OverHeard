// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSettingsModal } from './VoiceSettingsModal';
import type { SpeechClient } from '../tts/piperClient';

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
});
