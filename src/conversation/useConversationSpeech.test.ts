// @vitest-environment jsdom
import { createSpeechHarness, speechAcrossRestart } from '../speech/__fixtures__/speechHarness';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationSpeech } from './useConversationSpeech';
import { prepareOnDeviceSpeech } from '../onDevice';
vi.mock('../onDevice', () => ({ prepareOnDeviceSpeech: vi.fn(async () => true) }));
const speech = createSpeechHarness({ emitStart: false });
const latest = speech.latest;

function setup(langB = 'es') {
  const onSend = vi.fn();
  const hook = renderHook(() =>
    useConversationSpeech({
      participants: { a: { lang: 'en' }, b: { lang: langB } },
      switchAfterMs: 2500,
      onSend,
    })
  );
  act(() => hook.result.current.start());
  return { ...hook, onSend };
}
beforeEach(() => {
  vi.useFakeTimers();
  speech.install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('conversation turn recognition', () => {
  it('carries unfinished words across a browser restart in the same speaker’s turn', async () => {
    const { onSend } = setup();
    await speech.replay(speechAcrossRestart);
    expect(onSend).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'Turn the page Read the heading');
    expect(speech.instances[0].start).toHaveBeenCalledTimes(2);
  });

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
      })
    );
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'why is it doubling');
  });
  it('replaces a corrected word instead of repeating the paragraph', () => {
    const { onSend } = setup();
    const finals = (texts: string[]) =>
      latest().onresult?.({
        resultIndex: texts.length - 1,
        results: texts.map((t) => ({ isFinal: true, 0: { transcript: t } })),
      });
    const a = 'and never bugs all you have the bee bug mode';
    const b = 'and never bugs while you have the bee bug mode on';
    act(() => finals([a]));
    act(() => finals([a, b]));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', b);
  });
  it('waits indefinitely through no-speech and unexpected ends', async () => {
    const { result, onSend } = setup();
    await speech.replay([{ type: 'error', error: 'no-speech' }, { type: 'end' }, { afterMs: 400, type: 'start' }]);
    act(() => vi.advanceTimersByTime(35000));
    expect(result.current.turn).toBe('a');
    expect(result.current.isListening).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    act(() => latest().result('finally'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledWith('a', 'finally');
  });
  it('passes the turn at the pause setting even across a browser restart', () => {
    const { onSend } = setup();
    act(() => {
      latest().result('hello');
      vi.advanceTimersByTime(1000);
      latest().onend?.();
    });
    act(() => vi.advanceTimersByTime(300));
    act(() => latest().onstart?.());
    act(() => vi.advanceTimersByTime(1100));
    expect(onSend).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'hello');
  });

  it('still passes the turn when the engine never reports onstart', () => {
    const { onSend } = setup();
    act(() => {
      latest().result('hello');
      vi.advanceTimersByTime(1000);
      latest().onend?.();
    });
    act(() => vi.advanceTimersByTime(1500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'hello');
  });

  it('passes the turn on time in a quiet room where the engine keeps ending and restarting', () => {
    const { result, onSend } = setup('en');
    const mic = latest();
    act(() => mic.result('pass the gravy'));
    // Android in a quiet room: the session ends about a second after every restart, before
    // the 2.5 s pause can run out, and restarts with a chime each time
    act(() => {
      vi.advanceTimersByTime(1000);
      mic.onend?.();
      vi.advanceTimersByTime(300);
      mic.onstart?.();
      vi.advanceTimersByTime(900);
      mic.onend?.();
      vi.advanceTimersByTime(250);
    });
    expect(onSend).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'pass the gravy');
    expect(result.current.turn).toBe('b');
    expect(speech.instances).toHaveLength(1);
  });

  it('uses a shorter pause setting exactly, whatever the mic is doing', () => {
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useConversationSpeech({
        participants: { a: { lang: 'en' }, b: { lang: 'en' } },
        switchAfterMs: 2000,
        onSend,
      })
    );
    act(() => result.current.start());
    const mic = latest();
    act(() => mic.result('happy thanksgiving'));
    act(() => {
      vi.advanceTimersByTime(800);
      mic.onend?.();
      vi.advanceTimersByTime(300);
      mic.onstart?.();
      vi.advanceTimersByTime(899);
    });
    expect(onSend).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'happy thanksgiving');
    expect(result.current.turn).toBe('b');
  });
  it('still waits for a speaker who keeps talking across restarts', () => {
    const { onSend } = setup('en');
    const mic = latest();
    act(() => mic.result('so the turkey', true, 0));
    for (let i = 1; i <= 4; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
        mic.onend?.();
        vi.advanceTimersByTime(300);
        mic.onstart?.();
        vi.advanceTimersByTime(800);
      });
      act(() => mic.result(`word${i}`, true, 0));
    }
    expect(onSend).not.toHaveBeenCalled();
  });
  it('restarts the same recognizer instead of replacing it (Android tablets)', () => {
    const { onSend } = setup('en');
    const first = latest();
    // Android: every result final and cumulative, session ends at each pause
    act(() => {
      first.result('', true, 0);
      first.result('good', true, 1);
      first.onresult?.({
        resultIndex: 2,
        results: ['', 'good', 'good morning dog police'].map((t) => ({ isFinal: true, 0: { transcript: t } })),
      });
      vi.advanceTimersByTime(1000);
      first.onend?.();
    });
    expect(speech.instances).toHaveLength(1);
    expect(first.abort).not.toHaveBeenCalled();
    expect(first.start).toHaveBeenCalledTimes(2);
    act(() => first.onstart?.());
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'good morning dog police');
    // The next session's indexes start at 0 again and belong to the other person
    act(() => first.result('yeah see', true, 0));
    act(() => {
      vi.advanceTimersByTime(1000);
      first.onend?.();
      first.onstart?.();
    });
    act(() => first.result('yeah see it works', true, 0));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenLastCalledWith('b', 'yeah see it works');
    expect(speech.instances).toHaveLength(1);
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
    expect(speech.instances).toHaveLength(1);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('stop during language preparation cannot start recognition later', async () => {
    let resolve!: (local: boolean) => void;
    vi.mocked(prepareOnDeviceSpeech).mockImplementationOnce(
      () =>
        new Promise<boolean>((complete) => {
          resolve = complete;
        })
    );
    const { result } = setup();
    act(() => result.current.start(true));
    act(() => result.current.stop());
    await act(async () => resolve(true));
    expect(speech.instances).toHaveLength(1);
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

  it.each(['not-allowed', 'service-not-allowed', 'language-not-supported'])('stops on fatal error %s', (error) => {
    const { result, onSend } = setup();
    act(() => latest().result('unfinished'));
    act(() => latest().onerror?.({ error }));
    act(() => vi.advanceTimersByTime(30000));
    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toMatch(
      error === 'language-not-supported' ? /doesn't support en/ : /Microphone permission/
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(speech.instances).toHaveLength(1);
  });

  it('hears an immediate same-language reply when Android already restarted after the final words', () => {
    const { result, onSend } = setup('en');
    const mic = latest();
    // Abort can take time to report end on a tablet. Speech during that gap is lost.
    mic.abort.mockImplementation(() => {});
    act(() => mic.result('Are you ready?'));
    act(() => {
      vi.advanceTimersByTime(1200);
      mic.onend?.();
    });
    expect(mic.start).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1300));
    expect(result.current.turn).toBe('b');
    act(() => mic.result('Yes I am', false));
    expect(result.current.interim).toBe('Yes I am');
    act(() => mic.result('Yes I am'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend.mock.calls).toEqual([
      ['a', 'Are you ready?'],
      ['b', 'Yes I am'],
    ]);
    // B's session contained words, so it still needs a clean boundary before A speaks.
    expect(mic.abort).toHaveBeenCalledTimes(1);
  });

  it('still resets at Auto handoff if the last session ended with unfinished speech', () => {
    const { onSend } = setup('en');
    const mic = latest();
    act(() => mic.result('I can', true, 0));
    act(() => mic.result('hear it', false, 1));
    act(() => {
      vi.advanceTimersByTime(1200);
      mic.onend?.();
      vi.advanceTimersByTime(1300);
    });
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'I can hear it');
    expect(mic.abort).toHaveBeenCalledTimes(1);
  });

  it('ignores several revisions of the previous turn before accepting the reply', () => {
    const { result, onSend } = setup('en');
    act(() => latest().result('still talkin', false));
    act(() => vi.advanceTimersByTime(2500));
    act(() => latest().result('still', true, 0));
    act(() => latest().result('still talking', false, 1));
    expect(result.current.interim).toBe('');
    act(() => latest().result('still talking', true, 1));
    expect(result.current.draft).toBe('');
    act(() => latest().result('still talking I can see it', true, 2));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend.mock.calls).toEqual([
      ['a', 'still talkin'],
      ['b', 'I can see it'],
    ]);
  });

  it('keeps a new reply that shares one word with the previous unfinished phrase', () => {
    const { result, onSend } = setup('en');
    act(() => latest().result('thank you', false));
    act(() => vi.advanceTimersByTime(2500));
    act(() => latest().result('you are welcome', false));
    expect(result.current.interim).toBe('you are welcome');
    act(() => latest().result('you are welcome'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend.mock.calls).toEqual([
      ['a', 'thank you'],
      ['b', 'you are welcome'],
    ]);
  });

  it('keeps one recognizer but starts a fresh session when both people speak the same language', () => {
    const { result, onSend } = setup('en');
    const first = latest();
    act(() => first.result('how are you'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'how are you');
    expect(result.current.turn).toBe('b');
    expect(speech.instances).toHaveLength(1);
    // The same recognizer starts a fresh session, so nothing of A's can open B's message
    expect(first.abort).toHaveBeenCalledOnce();
    expect(first.start).toHaveBeenCalledTimes(2);
    act(() => first.result('fine thanks', true, 0));
    act(() => result.current.setTurn('a'));
    expect(onSend).toHaveBeenLastCalledWith('b', 'fine thanks');
    expect(result.current.turn).toBe('a');
    expect(speech.instances).toHaveLength(1);
  });
  it('keeps a same-language recognizer when unfinished words were sent, without repeating them', () => {
    const { result, onSend } = setup('en');
    const first = latest();
    act(() => first.result('still talkin', false));
    act(() => result.current.setTurn('b'));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'still talkin');
    expect(speech.instances).toHaveLength(1);
    expect(first.start).toHaveBeenCalledTimes(2);
    // The sent words still show up as interim, then as a revised final: neither is B's
    act(() => first.result('still talking', false));
    expect(result.current.interim).toBe('');
    act(() => first.result('still talking', true));
    expect(result.current.draft).toBe('');
    act(() => first.result('sounds good', true, 1));
    act(() => result.current.setTurn('a'));
    expect(onSend).toHaveBeenLastCalledWith('b', 'sounds good');
  });

  it('ignores what the ended session still delivers before it restarts', () => {
    const { result, onSend } = setup('en');
    const first = latest();
    // A real engine reports the end later, not inside abort()
    first.abort.mockImplementation(() => {});
    act(() => first.result('how are you doing', false));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'how are you doing');
    expect(result.current.turn).toBe('b');
    // The old session flushes its copy of A's words: none of it is B's
    act(() => first.result('how are you doing today', true));
    expect(result.current.draft).toBe('');
    expect(result.current.interim).toBe('');
    act(() => first.onend?.());
    expect(first.start).toHaveBeenCalledTimes(2);
    act(() => first.result('great thanks', true, 0));
    act(() => result.current.setTurn('a'));
    expect(onSend).toHaveBeenLastCalledWith('b', 'great thanks');
  });

  it('replaces the mic if the ended session never reports its end', () => {
    const { onSend } = setup('en');
    const first = latest();
    first.abort.mockImplementation(() => {});
    act(() => first.result('hello there'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'hello there');
    act(() => vi.advanceTimersByTime(1500));
    expect(speech.instances).toHaveLength(2);
    act(() => latest().result('hi', true, 0));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenLastCalledWith('b', 'hi');
  });

  it('auto-switch mid-phrase restarts the session and drops a repeated copy of the sent words', () => {
    const { result, onSend } = setup('en');
    const first = latest();
    act(() => {
      first.result('why', true, 0);
      first.result('why is it', false, 1);
    });
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'why is it');
    expect(result.current.turn).toBe('b');
    expect(speech.instances).toHaveLength(1);
    // Worst case: the new session repeats all of A's words before B's
    act(() => first.result('why is it', true, 0));
    expect(result.current.draft).toBe('');
    act(() => first.result('why is it because', true, 1));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenLastCalledWith('b', 'because');
  });

  it('drops sent words repeated by the session after an engine restart', () => {
    const { result, onSend } = setup('en');
    act(() => latest().result('see you', false));
    act(() => result.current.setTurn('b'));
    act(() => {
      latest().onend?.();
      vi.advanceTimersByTime(400);
    });
    expect(speech.instances).toHaveLength(1);
    expect(latest().start).toHaveBeenCalledTimes(3);
    act(() => latest().result('see you tomorrow', true));
    act(() => result.current.setTurn('a'));
    expect(onSend).toHaveBeenLastCalledWith('b', 'tomorrow');
  });

  it('keeps an exact echo reply when reusing a same-language recognizer', () => {
    const { onSend } = setup('en');
    const first = latest();
    act(() => first.result('Happy Thanksgiving'));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('a', 'Happy Thanksgiving');

    // Other speaker says the exact same phrase on the next result index
    act(() => first.result('Happy Thanksgiving', true, 1));
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenLastCalledWith('b', 'Happy Thanksgiving');
    expect(speech.instances).toHaveLength(1);
  });

  it('reassigns live speech to the other same-language speaker without splitting or restarting', () => {
    const { result, onSend } = setup('en');
    const first = latest();
    act(() => first.result('Hey Grandpa', false));
    act(() => result.current.reassignTurn('b'));
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.turn).toBe('b');
    expect(result.current.interim).toBe('Hey Grandpa');
    expect(speech.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2500));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('b', 'Hey Grandpa');
  });

  it('stops with a clear error on audio-capture and clears network notice on speech or stop', () => {
    const { result } = setup('en');
    act(() => latest().onerror?.({ error: 'network' }));
    expect(result.current.error).toMatch(/Reconnecting/);
    act(() => latest().result('back online'));
    expect(result.current.error).toBeNull();

    act(() => latest().onerror?.({ error: 'network' }));
    act(() => result.current.stop());
    expect(result.current.error).toBeNull();

    act(() => result.current.start(false, 'a'));
    act(() => latest().onerror?.({ error: 'audio-capture' }));
    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toMatch(/Microphone is unavailable/);
  });
});
