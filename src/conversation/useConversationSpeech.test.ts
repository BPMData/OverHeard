// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationSpeech } from './useConversationSpeech';
import { prepareOnDeviceSpeech } from '../onDevice';
vi.mock('../onDevice', () => ({ prepareOnDeviceSpeech: vi.fn(async () => true) }));
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  result(text: string, final = true, index = 0) {
    const results = Array.from({ length: index + 1 }, () => ({
      isFinal: false,
      0: { transcript: '' },
    }));
    results[index] = { isFinal: final, 0: { transcript: text } };
    this.onresult?.({ resultIndex: index, results });
  }
}
const latest = () => FakeRecognition.instances.at(-1)!;
function setup() {
  const onSend = vi.fn();
  const hook = renderHook(() =>
    useConversationSpeech({
      participants: { a: { lang: 'en' }, b: { lang: 'es' } },
      switchAfterMs: 2500,
      onSend,
    }),
  );
  act(() => hook.result.current.start());
  return { ...hook, onSend };
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('conversation turn recognition', () => {
  it('appends final fragments once and resets silence for interim speech', () => {
    const { result, onSend } = setup();
    act(() => latest().result('hello'));
    act(() => {
      vi.advanceTimersByTime(2000);
      latest().result('friend', false, 1);
    });
    act(() => vi.advanceTimersByTime(2000));
    expect(onSend).not.toHaveBeenCalled();
    act(() => {
      latest().result('friend', true, 1);
      latest().result('friend', true, 1);
    });
    expect(result.current.draft).toBe('hello friend');
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'hello friend');
    expect(result.current.turn).toBe('b');
    expect(latest().lang).toBe('es-US');
  });
  it('does not repeat cumulative Android results in the sent message', () => {
    const { result, onSend } = setup();
    act(() => {
      latest().result('why', true, 0);
      latest().result('why is', true, 1);
      latest().result('why is it doubling', false, 2);
    });
    expect(result.current.draft).toBe('why is');
    expect(result.current.interim).toBe('it doubling');
    // The engine ends mid-phrase; the next session repeats the tail before adding to it
    act(() => {
      latest().onend?.();
      vi.advanceTimersByTime(400);
    });
    act(() => latest().result('it doubling anything', true, 0));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'why is it doubling anything');
  });
  it('sends one copy when the engine keeps several growing unfinished results', () => {
    const { onSend } = setup();
    act(() =>
      latest().onresult?.({
        resultIndex: 0,
        results: ['why', 'why is', 'why is it doubling'].map((t) => ({ isFinal: false, 0: { transcript: t } })),
      }),
    );
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'why is it doubling');
  });
  it('waits indefinitely through no-speech and unexpected ends', () => {
    const { result, onSend } = setup();
    act(() => {
      latest().onerror?.({ error: 'no-speech' });
      latest().onend?.();
      vi.advanceTimersByTime(400);
    });
    act(() => vi.advanceTimersByTime(35000));
    expect(result.current.turn).toBe('a');
    expect(result.current.isListening).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    act(() => latest().result('finally'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledWith('a', 'finally');
  });
  it('sends across a browser restart without losing the silence timer', () => {
    const { onSend } = setup();
    act(() => {
      latest().result('hello');
      latest().onend?.();
    });
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'hello');
  });
  it('manual override sends first and quiet override sends nothing', () => {
    const { result, onSend } = setup();
    act(() => result.current.setTurn('b'));
    expect(onSend).not.toHaveBeenCalled();
    act(() => latest().result('hola'));
    act(() => result.current.setTurn('a'));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('b', 'hola');
    act(() => vi.advanceTimersByTime(10000));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('stop cancels pending restart and ignores stale callbacks', () => {
    const { result, onSend } = setup();
    const stale = latest().onresult!;
    act(() => latest().onend?.());
    act(() => result.current.stop());
    act(() => {
      vi.advanceTimersByTime(10000);
      stale({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] });
    });
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('stop during language preparation cannot start recognition later', async () => {
    let resolve!: (local: boolean) => void;
    vi.mocked(prepareOnDeviceSpeech).mockImplementationOnce(
      () =>
        new Promise<boolean>((complete) => {
          resolve = complete;
        }),
    );
    const { result } = setup();
    act(() => result.current.start(true));
    act(() => result.current.stop());
    await act(async () => resolve(true));
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(result.current.isListening).toBe(false);
  });
  it('suspends recognition and resumes the intended turn', () => {
    const { result, onSend } = setup();
    act(() => result.current.suspend());
    act(() => result.current.setTurn('b'));
    act(() => vi.advanceTimersByTime(10000));
    expect(onSend).not.toHaveBeenCalled();
    act(() => result.current.resume());
    expect(latest().lang).toBe('es-US');
  });
  it('preserves prior interim text across an unexpected restart', () => {
    const { onSend } = setup();
    act(() => latest().result('first phrase', false));
    act(() => latest().onend?.());
    act(() => vi.advanceTimersByTime(300));
    act(() => latest().result('second phrase'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'first phrase second phrase');
  });

  it('resumes the silence timer for a suspended draft', () => {
    const { result, onSend } = setup();
    act(() => latest().result('keep these words', false));
    act(() => result.current.suspend());
    act(() => vi.advanceTimersByTime(30000));
    expect(onSend).not.toHaveBeenCalled();
    act(() => result.current.resume());
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'keep these words');
    expect(result.current.turn).toBe('b');
  });

  it.each(['not-allowed', 'service-not-allowed', 'language-not-supported'])(
    'stops on fatal error %s',
    (error) => {
      const { result, onSend } = setup();
      act(() => latest().result('unfinished'));
      act(() => latest().onerror?.({ error }));
      act(() => vi.advanceTimersByTime(30000));
      expect(result.current.isListening).toBe(false);
      expect(result.current.error).toMatch(
        error === 'language-not-supported' ? /doesn't support en/ : /Microphone permission/,
      );
      expect(onSend).not.toHaveBeenCalled();
      expect(FakeRecognition.instances).toHaveLength(1);
    },
  );
});
