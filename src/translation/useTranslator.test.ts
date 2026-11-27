// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MT_PREFERENCE_STORAGE_KEY } from '../app/settings';
import { RateLimitedError } from '../http';
import { useTranslator } from './useTranslator';

vi.mock('../app/settings', async (original) => ({
  ...await original<typeof import('../app/settings')>(),
  MT_CLIENT_CACHE_MAX: 1,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('keeps a replacement translation cached when the evicted request later fails', async () => {
  localStorage.setItem(MT_PREFERENCE_STORAGE_KEY, 'gtx');
  let finishOld!: (response: Response) => void;
  const fetch = vi.fn(async () => Response.json({ translation: 'hola', provider: 'gtx' }))
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useTranslator(['gtx']));
  const translate = (text: string) => result.current.fetchMT(text, 'es');

  const first = translate('hello');
  await act(async () => { await translate('another phrase'); });
  const replacement = translate('hello');
  await act(async () => { await replacement; });
  finishOld(new Response(null, { status: 429 }));
  await expect(first).rejects.toBeInstanceOf(RateLimitedError);

  expect(translate('hello')).toBe(replacement);
  expect(fetch).toHaveBeenCalledTimes(3);
});
