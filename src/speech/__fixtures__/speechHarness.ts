import { act } from '@testing-library/react';
import { vi } from 'vitest';

type Result = { isFinal: boolean; 0: { transcript: string } };
type SpeechStep = { afterMs?: number } & (
  | { type: 'start' | 'end' }
  | { type: 'error'; error: string }
  | { type: 'result'; resultIndex: number; results: Result[] }
);

// A browser ends a healthy session before it finalizes a clause, then starts again.
// Each mode has its own contract for the unfinished words.
export const speechAcrossRestart: SpeechStep[] = [
  { type: 'result', resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'Turn the page' } }] },
  { afterMs: 1100, type: 'end' },
  { afterMs: 100, type: 'result', resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Read the heading' } }] },
];

export function createSpeechHarness({ emitStart = true } = {}) {
  const instances: FakeRecognition[] = [];

  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    processLocally = false;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onresult: ((event: { resultIndex: number; results: Result[] }) => void) | null = null;
    start = vi.fn(() => {
      if (emitStart) this.onstart?.();
    });
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn(() => {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    });

    constructor() {
      instances.push(this);
    }

    result(text: string, final = true, index = 0) {
      const results = Array.from({ length: index + 1 }, () => ({ isFinal: false, 0: { transcript: '' } }));
      results[index] = { isFinal: final, 0: { transcript: text } };
      this.onresult?.({ resultIndex: index, results });
    }
  }

  function latest() {
    const mic = instances.at(-1);
    if (!mic) throw new Error('Start recognition before delivering speech events.');
    return mic;
  }

  // afterMs is relative to the preceding event. The hook may replace its mic during the wait.
  async function replay(steps: readonly SpeechStep[]) {
    for (const step of steps) {
      const { afterMs } = step;
      if (afterMs)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(afterMs);
        });
      await act(async () => {
        const mic = latest();
        switch (step.type) {
          case 'start':
            mic.onstart?.();
            break;
          case 'end':
            mic.onend?.();
            break;
          case 'error':
            mic.onerror?.({ error: step.error });
            break;
          case 'result':
            mic.onresult?.({ resultIndex: step.resultIndex, results: step.results });
            break;
        }
      });
    }
  }

  function install() {
    instances.length = 0;
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
  }

  return { instances, latest, replay, install };
}
