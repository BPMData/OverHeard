// @vitest-environment jsdom
import React from 'react';
import { createSpeechHarness } from './speech/__fixtures__/speechHarness';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationLanguage } from './types';
import { parseRoomJson } from './rooms/protocol';
import { piperClient } from './tts/piperClient';

// Isolate the App integration boundary: the real conversation turn loop has its own tests.
vi.mock('./components/ConversationMode', () => ({
  ConversationMode: ({
    active,
    onExit,
    onHome,
    translate,
  }: {
    active: boolean;
    onExit: () => void;
    onHome?: () => void;
    translate: (text: string, target: ConversationLanguage, source?: ConversationLanguage) => Promise<string>;
  }) =>
    active ? (
      <section aria-label="Conversation test surface">
        <button onClick={onHome ?? onExit}>OverHeard — Go to Columns view</button>
        <button onClick={onExit}>Exit conversation</button>
        <button
          onClick={() => {
            void translate('same', 'es', 'en');
          }}
        >
          Translate forward
        </button>
        <button
          onClick={() => {
            void translate('same', 'en', 'es');
          }}
        >
          Translate reverse
        </button>
        <button
          onClick={() => {
            void translate('same', 'es', 'fr');
          }}
        >
          Translate other source
        </button>
        <button
          onClick={() => {
            void translate('same', 'en', 'en');
          }}
        >
          Caption same language
        </button>
      </section>
    ) : null,
}));

import App from './App';

const speech = createSpeechHarness();

let mtCalls: Array<{ text: string; lang: string; source: string }>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/?langs=es');
  speech.install();
  mtCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/mt') {
        const body = JSON.parse(String(init?.body));
        mtCalls.push(body);
        return new Response(JSON.stringify({ translation: `${body.source}>${body.lang}`, provider: 'gtx' }));
      }
      return new Response(JSON.stringify({ providers: ['gtx'] }));
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function enterConversation() {
  fireEvent.click(screen.getByRole('button', { name: 'Lecture/Conversation' }));
  await screen.findByRole('region', { name: 'Conversation test surface' });
}

describe('App conversation integration', () => {
  it('hands off the microphone, disables Space in conversation and restores the previous mode stopped', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }));
    fireEvent.click(screen.getByRole('button', { name: /Start Listening/ }));
    const recognition = speech.instances[0];
    expect(recognition.start).toHaveBeenCalledTimes(1);
    await enterConversation();
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Start Listening/ })).toBeNull();
    fireEvent.keyDown(window, { code: 'Space' });
    expect(recognition.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Exit conversation' }));
    expect(screen.getByRole('button', { name: /Start Listening/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subtitle' }).className).toContain('shadow-2xs');
    expect(recognition.start).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: 'Space' });
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });

  it('passes both languages to MT, isolates cached pairs and bypasses equal-language calls', async () => {
    render(<App />);
    await enterConversation();
    fireEvent.click(screen.getByRole('button', { name: 'Caption same language' }));
    await act(async () => {});
    expect(mtCalls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Translate forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate reverse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate other source' }));
    await waitFor(() => expect(mtCalls).toHaveLength(3));
    expect(mtCalls).toEqual([
      { text: 'same', lang: 'es', source: 'en' },
      { text: 'same', lang: 'en', source: 'es' },
      { text: 'same', lang: 'es', source: 'fr' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Translate forward' }));
    await act(async () => {});
    expect(mtCalls).toHaveLength(3);
  });

  it('opens Settings from the home page and imports a lecture JSON file into Lecture mode', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Default Portuguese voice'), {
      target: { value: 'pt_BR-cadu-medium' },
    });
    expect(JSON.parse(localStorage.getItem('overheard.voices')!).pt).toBe('pt_BR-cadu-medium');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    const lecturePayload = JSON.stringify({
      format: 'overheard-lecture',
      version: 1,
      exportedAt: '2026-11-11T12:00:00.000Z',
      selectedLangs: ['pt'],
      entries: [
        {
          id: 'lec-1',
          timestamp: 1000,
          english: 'Imported line',
          translations: { pt: 'Linha importada' },
          failedLangs: {},
        },
      ],
    });
    const file = new File([lecturePayload], 'lecture.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import lecture JSON on home screen'), {
        target: { files: [file] },
      });
    });

    await screen.findByRole('region', { name: 'Conversation test surface' });
    expect(JSON.parse(localStorage.getItem('overheard.lecture')!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('overheard.conversation')!).mode).toBe('lecture');
  });

  it('exports Columns captions as valid OverHeard JSON instead of CSV', async () => {
    let exportedBlob: Blob | null = null;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      exportedBlob = blob as Blob;
      return 'blob:columns-export';
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: 'Test Input' }));
      fireEvent.change(
        screen.getByPlaceholderText('Type an English classroom sentence to test translation silently…'),
        { target: { value: 'Hello class' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

      await waitFor(() => expect(screen.getByText('en>es')).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: 'File' }));
      const exportBtn = screen.getByRole('button', { name: 'Export JSON' });
      expect(screen.queryByRole('button', { name: /CSV/i })).toBeNull();
      fireEvent.click(exportBtn);

      expect(clickSpy).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toMatch(/^Lecture on .+\.json$/);
      expect(exportedBlob).not.toBeNull();
      expect(exportedBlob!.type).toBe('application/json');

      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsText(exportedBlob!);
      });
      const parsed = parseRoomJson(text);
      expect(parsed.selectedLangs).toEqual(['es']);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toMatchObject({
        english: 'Hello class',
        translations: { es: 'en>es' },
      });
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('returns to Columns view when clicking the top-left OverHeard brand from Subtitle or Conversation mode', async () => {
    render(<App />);

    // Switch to Subtitle view, then click top-left OverHeard brand -> returns to Columns view
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }));
    expect(screen.getByRole('button', { name: 'Subtitle' }).className).toContain('shadow-2xs');
    fireEvent.click(screen.getByRole('button', { name: 'OverHeard — Go to Columns view' }));
    expect(screen.getByRole('button', { name: 'Columns' }).className).toContain('shadow-2xs');
    expect(screen.getByRole('button', { name: 'Subtitle' }).className).not.toContain('shadow-2xs');

    // Enter Conversation mode from Subtitle view, then click OverHeard brand -> goes to Columns (not Subtitle)
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }));
    await enterConversation();
    fireEvent.click(screen.getByRole('button', { name: 'OverHeard — Go to Columns view' }));
    expect(screen.getByRole('button', { name: 'Columns' }).className).toContain('shadow-2xs');
    expect(screen.getByRole('button', { name: 'Subtitle' }).className).not.toContain('shadow-2xs');
  });

  it('translates finished captions with /api/mt only, with no Gemini refinement option', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (url === '/api/mt') {
          const body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ translation: `${body.source}>${body.lang}`, provider: 'gtx' }));
        }
        return new Response(JSON.stringify({ providers: ['gtx'] }));
      })
    );

    render(<App />);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Test Input' }));
    const input = screen.getByPlaceholderText('Type an English classroom sentence to test translation silently…');
    fireEvent.change(input, { target: { value: 'First sentence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.getByText('en>es')).toBeTruthy());
    await act(async () => {});
    expect(urls).not.toContain('/api/translate');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('checkbox', { name: /Gemini/i })).toBeNull();
    expect(screen.getByText(/Zero-Cloud \/ On-Device Guarantee/i)).toBeTruthy();
  });

  it('reads aloud and stops translated speech in Columns view using the selected voice', async () => {
    const stopMock = vi.fn();
    let callbacks: { onStart?: () => void; onEnd?: () => void } | undefined;
    const speakSpy = vi.spyOn(piperClient, 'speak').mockImplementation((_text, opts) => {
      callbacks = opts;
      opts.onStart?.();
      return { pause: vi.fn(), resume: vi.fn(), stop: stopMock };
    });
    const unlockSpy = vi.spyOn(piperClient, 'unlockAudio').mockImplementation(() => {});

    try {
      localStorage.setItem('overheard.voices', JSON.stringify({ es: 'es_MX-ald-medium' }));
      render(<App />);

      const playButton = screen.getByRole('button', { name: 'Read Spanish translation aloud' }) as HTMLButtonElement;
      expect(playButton.disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Test Input' }));
      fireEvent.change(
        screen.getByPlaceholderText('Type an English classroom sentence to test translation silently…'),
        { target: { value: 'Hello class' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
      await waitFor(() => expect(screen.getByText('en>es')).toBeTruthy());

      expect(playButton.disabled).toBe(false);
      fireEvent.click(playButton);

      expect(unlockSpy).toHaveBeenCalledTimes(1);
      expect(speakSpy).toHaveBeenCalledWith(
        'en>es',
        expect.objectContaining({ lang: 'es', voiceId: 'es_MX-ald-medium' })
      );

      const stopButton = screen.getByRole('button', { name: 'Stop reading Spanish translation' });
      fireEvent.click(stopButton);
      expect(stopMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Read Spanish translation aloud' })).toBeTruthy();

      // Natural completion also clears active playback state
      fireEvent.click(screen.getByRole('button', { name: 'Read Spanish translation aloud' }));
      act(() => callbacks?.onEnd?.());
      expect(screen.getByRole('button', { name: 'Read Spanish translation aloud' })).toBeTruthy();
    } finally {
      speakSpy.mockRestore();
      unlockSpy.mockRestore();
    }
  });
});
