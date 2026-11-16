// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationLanguage } from './types';
import { parseRoomJson } from './rooms/protocol';

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
    translate: (
      text: string,
      target: ConversationLanguage,
      source?: ConversationLanguage,
    ) => Promise<string>;
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

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  onstart?: () => void;
  onend?: () => void;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

let mtCalls: Array<{ text: string; lang: string; source: string }>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/?langs=es');
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  mtCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/mt') {
        const body = JSON.parse(String(init?.body));
        mtCalls.push(body);
        return new Response(
          JSON.stringify({ translation: `${body.source}>${body.lang}`, provider: 'gtx' }),
        );
      }
      return new Response(JSON.stringify({ refine: false, providers: ['gtx'] }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function enterConversation() {
  fireEvent.click(screen.getByRole('button', { name: 'Conversation/Lecture' }));
  await screen.findByRole('region', { name: 'Conversation test surface' });
}

describe('App conversation integration', () => {
  it('hands off the microphone, disables Space in conversation and restores the previous mode stopped', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }));
    fireEvent.click(screen.getByRole('button', { name: /Start Listening/ }));
    const recognition = FakeRecognition.instances[0];
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

  it('opens Voice settings from the home page and imports a lecture JSON file into Lecture mode', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Voice settings' }));
    expect(screen.getByRole('dialog', { name: 'Voice Settings' })).toBeTruthy();
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
        { target: { value: 'Hello class' } },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

      await waitFor(() => expect(screen.getByText('en>es')).toBeTruthy());

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
});
