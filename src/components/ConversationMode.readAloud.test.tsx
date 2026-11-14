// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMode } from './ConversationMode';

type ResultCallback = (event: {
  resultIndex: number;
  results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
}) => void;
class Recognition {
  static instances: Recognition[] = [];
  lang = '';
  onresult: ResultCallback | null = null;
  onerror = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    Recognition.instances.push(this);
  }
}
class Utterance {
  lang = '';
  voice: { lang: string } | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
let queue: Utterance[];
let speak: ReturnType<typeof vi.fn>;
const result = (callback: ResultCallback | null, text: string) =>
  callback?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const finishVoice = async () => {
  await act(async () => {
    queue.shift()?.onend?.();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Recognition.instances = [];
  queue = [];
  speak = vi.fn((utterance: Utterance) => queue.push(utterance));
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', {
    speak,
    cancel: vi.fn(() => {
      queue = [];
    }),
    getVoices: () => [{ lang: 'es-US' }, { lang: 'en-US' }],
    get speaking() {
      return queue.length > 0;
    },
    get pending() {
      return queue.length > 1;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  const translate = vi.fn(async (text: string) => `translated ${text}`);
  render(
    <ConversationMode
      active
      fontSize={32}
      isDark
      translate={translate}
      mtPreference="auto"
      onExit={vi.fn()}
      onPermissionDenied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Read aloud' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  return { translate };
}

describe('conversation read aloud', () => {
  it('suspends speech for the whole voice queue and resumes the intended hands-free turn', async () => {
    const { translate } = mount();
    const firstRecognition = Recognition.instances[0];
    const staleResult = firstRecognition.onresult;
    await act(async () => {
      result(firstRecognition.onresult, 'Hello');
    });
    await tick(2500);
    expect(translate).toHaveBeenCalledWith('Hello', 'es', 'en');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(queue[0]).toMatchObject({
      text: 'translated Hello',
      lang: 'es',
      voice: { lang: 'es-US' },
    });
    const instancesWhileSpeaking = Recognition.instances.length;
    expect(Recognition.instances.at(-1)?.abort).toHaveBeenCalled();

    // Another message may arrive while the previous translation is being read.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message text' }), {
      target: { value: 'One more' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {});
    expect(queue).toHaveLength(2);
    await act(async () => {
      result(staleResult, 'speaker playback must be ignored');
    });
    await tick(30_000);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(Recognition.instances).toHaveLength(instancesWhileSpeaking);
    await finishVoice();
    expect(Recognition.instances).toHaveLength(instancesWhileSpeaking);
    await finishVoice();
    expect(Recognition.instances).toHaveLength(instancesWhileSpeaking + 1);
    const replyRecognition = Recognition.instances.at(-1)!;
    expect(replyRecognition.lang).toBe('es-US');
    expect(screen.getByRole('status').textContent).toContain('Listening for Student');
    await tick(30_000);
    expect(translate).toHaveBeenCalledTimes(2);
    await act(async () => {
      result(replyRecognition.onresult, 'Hola');
    });
    await tick(2500);
    expect(translate).toHaveBeenLastCalledWith('Hola', 'en', 'es');
    await finishVoice();
    expect(Recognition.instances.at(-1)?.lang).toBe('en-US');
    expect(screen.getByRole('status').textContent).toContain('Listening for Me');
  });

  it('does not restart recognition when playback ends after Stop', async () => {
    mount();
    await act(async () => {
      result(Recognition.instances[0].onresult, 'Hello');
    });
    await tick(2500);
    const count = Recognition.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Stop conversation' }));
    await finishVoice();
    expect(Recognition.instances).toHaveLength(count);
    expect(screen.getByRole('status').textContent).toContain('Conversation stopped');
  });
});
