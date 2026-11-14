// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationLanguage } from './types';

// Isolate the App integration boundary: the real conversation turn loop has its own tests.
vi.mock('./components/ConversationMode', () => ({
  ConversationMode: ({
    active,
    onExit,
    translate,
  }: {
    active: boolean;
    onExit: () => void;
    translate: (
      text: string,
      target: ConversationLanguage,
      source?: ConversationLanguage,
    ) => Promise<string>;
  }) =>
    active ? (
      <section aria-label="Conversation test surface">
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
  fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
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
});
