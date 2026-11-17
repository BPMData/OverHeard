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

function mount(readAloud = true) {
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
  if (readAloud) fireEvent.click(screen.getByRole('checkbox', { name: 'Read aloud' }));
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

  it('does not restart recognition when playback ends after Pause', async () => {
    mount();
    await act(async () => {
      result(Recognition.instances[0].onresult, 'Hello');
    });
    await tick(2500);
    const count = Recognition.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Pause conversation' }));
    await finishVoice();
    expect(Recognition.instances).toHaveLength(count);
    expect(screen.getByRole('status').textContent).toContain('Conversation stopped');
  });
});

it('holds a live draft in manual mode and passes it once by Space or button', async () => {
  const { translate } = mount(false);
  await act(async () => result(Recognition.instances[0].onresult, 'One moment'));
  fireEvent.change(screen.getByLabelText('Turn-taking'), { target: { value: 'manual' } });
  await tick(30_000);
  const next = screen.getByRole('button', { name: /Next speaker/ });
  expect(document.activeElement).toBe(next);
  fireEvent.keyDown(screen.getByLabelText('Message text'), { code: 'Space' });
  fireEvent.keyDown(next, { code: 'Space', repeat: true });
  expect(translate).not.toHaveBeenCalled();
  fireEvent.keyDown(next, { code: 'Space' });
  expect(translate).toHaveBeenCalledExactlyOnceWith('One moment', 'es', 'en');
  expect(screen.getByRole('status').textContent).toContain('Listening for Student');
  fireEvent.click(next);
  expect(screen.getByRole('status').textContent).toContain('Listening for Me');
  expect(translate).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('overheard.conversation')!).manualTurns).toBe(true);
  await act(async () => result(Recognition.instances.at(-1)!.onresult, 'Ready'));
  fireEvent.change(screen.getByLabelText('Turn-taking'), { target: { value: 'auto' } });
  await tick(2500);
  expect(translate).toHaveBeenLastCalledWith('Ready', 'es', 'en');
});

it('imports a conversation JSON into the conversation thread without reading imported messages aloud', async () => {
  mount(true);
  const payload = JSON.stringify({
    format: 'overheard-conversation',
    version: 1,
    exportedAt: '2026-11-13T16:02:00.000Z',
    messages: [
      {
        timestamp: '2026-11-13T16:00:00.000Z',
        side: 'a',
        sender: { name: 'Me', lang: 'en' },
        reader: { name: 'Student', lang: 'es' },
        original: 'Good morning',
        translated: 'Buenos días',
        status: 'done',
      },
      {
        timestamp: '2026-11-13T16:01:00.000Z',
        side: 'b',
        sender: { name: 'Student', lang: 'es' },
        reader: { name: 'Me', lang: 'en' },
        original: 'Hola',
        translated: 'Hello',
        status: 'done',
      },
    ],
  });
  const file = new File([payload], 'conversation.json', { type: 'application/json' });
  const input = screen.getByLabelText('Import JSON file');
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  expect(screen.getByText('Buenos días')).toBeTruthy();
  expect(screen.getByText('Good morning')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
  expect(speak).not.toHaveBeenCalled();

  // Selecting Side A/B voices persists preferences and bubble ▶ button replays an imported bubble
  fireEvent.change(screen.getByLabelText('Side B voice'), { target: { value: 'es_MX-ald-medium' } });
  expect(JSON.parse(localStorage.getItem('overheard.voices')!).es).toBe('es_MX-ald-medium');

  const countBeforeReplay = Recognition.instances.length;
  fireEvent.click(screen.getByRole('button', { name: 'Read aloud: Good morning' }));
  expect(speak).toHaveBeenCalledTimes(1);
  expect(queue[0].text).toBe('Buenos días');
  expect(Recognition.instances.at(-1)?.abort).toHaveBeenCalled();

  await finishVoice();
  expect(Recognition.instances).toHaveLength(countBeforeReplay + 1);
});

it('plays and stops any two-way message bubble even when Read aloud is unchecked', async () => {
  const { translate } = mount(false);
  await act(async () => result(Recognition.instances[0].onresult, 'Hello student'));
  await tick(2500);
  expect(translate).toHaveBeenCalledWith('Hello student', 'es', 'en');
  expect(speak).not.toHaveBeenCalled();

  const playBtn = screen.getByRole('button', { name: 'Read aloud: Hello student' });
  fireEvent.click(playBtn);
  expect(speak).toHaveBeenCalledTimes(1);
  expect(queue[0].text).toBe('translated Hello student');

  fireEvent.click(screen.getByRole('button', { name: 'Stop reading Hello student' }));
  expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Read aloud: Hello student' })).toBeTruthy();
});
