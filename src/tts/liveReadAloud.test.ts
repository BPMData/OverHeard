// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LectureEntry } from '../conversation/lectureState';
import type { PlaybackHandle, SpeakOptions, SpeechClient } from './piperClient';
import { LIVE_PLAYBACK_ID, useLecturePlayback } from './useSpeechPlayback';

function fakeClient() {
  const spoken: { text: string; options: SpeakOptions }[] = [];
  const client: SpeechClient = {
    isPiperSupported: () => true,
    shouldUsePiper: () => true,
    preloadVoice: vi.fn(),
    prefetch: vi.fn(),
    unlockAudio: vi.fn(),
    subscribeStatus: () => () => {},
    speak: (text, options) => {
      spoken.push({ text, options });
      const handle: PlaybackHandle = { stop: vi.fn(), pause: vi.fn(), resume: vi.fn() } as unknown as PlaybackHandle;
      return handle;
    },
  };
  // Finish the clip that is playing now
  const finish = async () => {
    await act(async () => {
      spoken[spoken.length - 1].options.onEnd?.();
    });
  };
  return { client, spoken, finish };
}

const entry = (id: string, english: string): LectureEntry => ({
  id,
  timestamp: 1,
  english,
  translations: { es: `es(${english})` },
  failedLangs: {},
});

describe('live read-aloud', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads settled words while the speaker is still talking, then only the rest of the line', async () => {
    const { client, spoken, finish } = fakeClient();
    const translate = vi.fn(async (text: string) => `es(${text})`);
    const onBeforePlay = vi.fn();
    const props = (interim: string, entries: LectureEntry[]) => ({
      entries,
      voicePrefs: {},
      readAloud: true,
      liveLang: 'es' as const,
      onBeforePlay,
      client,
      live: { interim, translate, suspendSpeech: false },
    });
    const hook = renderHook((p: ReturnType<typeof props>) => useLecturePlayback(p), { initialProps: props('', []) });

    hook.rerender(props('today we will look', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // No pause and nothing finalized, yet the first settled words are being read
    expect(spoken.map((s) => s.text)).toEqual(['es(today we will look)']);
    expect(hook.result.current.activePlayback?.entryId).toBe(LIVE_PLAYBACK_ID);

    hook.rerender(props('today we will look at the water cycle and', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // The next piece's audio is prepared while the first one is still playing
    expect(client.prefetch).toHaveBeenCalledWith('es(at the water cycle and)', expect.any(String));
    // The reading voice was loaded as soon as reading was on
    expect(client.preloadVoice).toHaveBeenCalled();
    await finish();
    expect(spoken.map((s) => s.text)).toEqual(['es(today we will look)', 'es(at the water cycle and)']);

    // The speaker pauses: the line is finalized. Only the unread end is spoken, not the whole line.
    hook.rerender(props('', [entry('a', 'Today we will look at the water cycle and rain.')]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await finish();
    expect(spoken.map((s) => s.text)).toEqual(['es(today we will look)', 'es(at the water cycle and)', 'es(rain.)']);
    await finish();
    expect(hook.result.current.status).toBe('idle');
    // The teacher's microphone kept listening throughout
    expect(onBeforePlay).not.toHaveBeenCalled();
  });

  it('still reads a short line whole when nothing was read live', async () => {
    const { client, spoken } = fakeClient();
    const props = (interim: string, entries: LectureEntry[]) => ({
      entries,
      voicePrefs: {},
      readAloud: true,
      liveLang: 'es' as const,
      client,
      live: { interim, translate: async (t: string) => `es(${t})`, suspendSpeech: false },
    });
    const hook = renderHook((p: ReturnType<typeof props>) => useLecturePlayback(p), { initialProps: props('', []) });
    hook.rerender(props('hi', []));
    hook.rerender(props('', [entry('a', 'Hi there.')]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(spoken.map((s) => s.text)).toEqual(['es(Hi there.)']);
  });
});
