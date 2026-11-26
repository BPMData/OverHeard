// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(
    'overheard.conversation',
    JSON.stringify({
      mode: 'two-way',
      layout: 'face-to-face',
      a: { name: 'Bryan', lang: 'en' },
      b: { name: 'Grandpa', lang: 'en' },
    }),
  );
  Recognition.instances = [];
  vi.stubGlobal('SpeechRecognition', Recognition);
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
      onAdjustFont={vi.fn()}
    />,
  );
  return { translate };
}

describe('face to face two-way', () => {
  it('starts from the tapped half and shows every line on both halves without translating', async () => {
    const { translate } = mount();
    // The toolbar stays out of the way until asked for
    expect(screen.queryByRole('button', { name: 'Start conversation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grandpa: tap, then talk' }));
    expect(screen.getByRole('button', { name: /🎙 Listening to Grandpa/ })).toBeTruthy();
    expect(Recognition.instances).toHaveLength(1);
    expect(Recognition.instances[0].lang).toBe('en-US');

    await act(async () => {
      Recognition.instances[0].onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'Pass the gravy' } }],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    for (const reader of ['Bryan', 'Grandpa']) {
      const log = screen.getByRole('log', { name: `Conversation for ${reader}` });
      expect(within(log).getByText('Pass the gravy')).toBeTruthy();
    }
    expect(translate).not.toHaveBeenCalled();
    // Hands-free passed the turn without restarting the microphone
    expect(screen.getByRole('button', { name: /🎙 Listening to Bryan/ })).toBeTruthy();
    expect(Recognition.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Bryan: tap, then talk' })).toBeTruthy();
  });

  it('passes turn when tapping your active button, guards accidental double-taps, and swaps mislabeled speakers', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Bryan: tap, then talk' }));
    const activeBtn = screen.getByRole('button', { name: /🎙 Listening to Bryan/ });

    // Immediate accidental double-tap before any words arrive stays on Bryan
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    fireEvent.click(activeBtn);
    expect(screen.getByRole('button', { name: /🎙 Listening to Bryan/ })).toBeTruthy();

    // Tapping after speaking passes the turn to Grandpa without needing to reach across
    await act(async () => {
      Recognition.instances[0].onresult?.({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: 'Actually Grandpa is talking' } }],
      });
    });
    // Flip live speech before it is sent
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch live speech to Grandpa' })[0]);
    expect(screen.getByRole('button', { name: /🎙 Listening to Grandpa/ })).toBeTruthy();

    // Tap active Grandpa button to commit and pass to Bryan
    fireEvent.click(screen.getByRole('button', { name: /🎙 Listening to Grandpa/ }));
    expect(screen.getByRole('button', { name: /🎙 Listening to Bryan/ })).toBeTruthy();

    // Move the finished message between speakers with ⇄
    const grandpaLog = screen.getByRole('log', { name: 'Conversation for Grandpa' });
    expect(within(grandpaLog).getByText('Grandpa')).toBeTruthy();
    fireEvent.click(within(grandpaLog).getByRole('button', { name: /Move "Actually Grandpa is talking" to Bryan/ }));
    expect(within(grandpaLog).getByText('Bryan')).toBeTruthy();
  });

  it('toggles Turns: Auto / Tap in the divider and hides translation/voice clutter for two English speakers', () => {
    mount();
    const turnsBtn = screen.getByRole('button', { name: 'Turns: Auto' });
    fireEvent.click(turnsBtn);
    expect(screen.getByRole('button', { name: 'Turns: Tap' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('overheard.conversation')!).manualTurns).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show controls' }));
    expect(screen.queryByLabelText('Side A voice')).toBeNull();
    expect(screen.queryByLabelText('Side B voice')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('Face to face (tablet between you)'), {
      target: { value: 'side-by-side' },
    });
    expect(screen.queryByRole('button', { name: 'Grandpa: tap, then talk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeTruthy();
  });
});
