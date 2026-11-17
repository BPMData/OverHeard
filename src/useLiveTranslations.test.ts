// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_THROTTLE_MS, useLiveTranslations } from './useLiveTranslations';

type Pending = { text: string; resolve: (value: string) => void };

function setup() {
  const pending: Pending[] = [];
  const translate = vi.fn((text: string) =>
    new Promise<string>((resolve) => pending.push({ text, resolve })));
  const hook = renderHook(
    ({ text, key }: { text: string; key: string }) => useLiveTranslations(text, ['es'], translate, key),
    { initialProps: { text: '', key: 'a' } },
  );
  return { pending, translate, hook };
}

describe('useLiveTranslations', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows translations while the speaker keeps talking without a pause', async () => {
    const { pending, hook } = setup();
    hook.rerender({ text: 'hello class', key: 'a' });
    expect(pending.map((p) => p.text)).toEqual(['hello class']);

    // Speech continues before the first response returns
    hook.rerender({ text: 'hello class today we', key: 'a' });
    await act(async () => pending[0].resolve('hola clase'));
    expect(hook.result.current.es).toBe('hola clase');

    // Only one request per chunk is in flight; the newest text is sent once it returns
    await act(async () => { vi.advanceTimersByTime(LIVE_THROTTLE_MS); });
    expect(pending.map((p) => p.text)).toEqual(['hello class', 'hello class today we']);
    await act(async () => pending[1].resolve('hola clase hoy'));
    expect(hook.result.current.es).toBe('hola clase hoy');
  });

  it('starts fresh for a new utterance', async () => {
    const { pending, hook } = setup();
    hook.rerender({ text: 'first line', key: 'a' });
    await act(async () => pending[0].resolve('primera'));
    hook.rerender({ text: 'second', key: 'b' });
    expect(hook.result.current.es).toBeUndefined();
    await act(async () => { vi.advanceTimersByTime(LIVE_THROTTLE_MS); });
    expect(pending.at(-1)!.text).toBe('second');
  });
});
