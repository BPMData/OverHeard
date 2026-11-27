import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MT_CLIENT_CACHE_MAX, MT_PREFERENCE_STORAGE_KEY, MT_PROVIDER_LABELS,
  ON_DEVICE_TIMEOUT_MS, mtCacheKey, overBy,
  type MtPreference, type MtProviderId, type TranslatorId,
} from '../app/settings';
import { createTranslationCache } from './translationCache';
import type { MtRequestBody, MtSuccessResponse } from './protocol';
import { useDeviceFirstTranslator } from './useDeviceFirstTranslator';
import { RateLimitedError } from '../http';
import { isOnDeviceTranslationSupported, translateOnDevice } from '../onDevice';
import { getSessionId, SESSION_HEADER } from '../session';
import type { ConversationLanguage, LanguageCode } from '../types';

export function useTranslator(availableProviders: MtProviderId[]) {
  const [cache] = useState(() => createTranslationCache(MT_CLIENT_CACHE_MAX));

  // 'auto' is the on-device-first default; retain the browser’s explicit choice.
  const [mtPreference, setMtPreference] = useState<MtPreference>(() => {
    try {
      const saved = localStorage.getItem(MT_PREFERENCE_STORAGE_KEY);
      if (saved && saved in MT_PROVIDER_LABELS) return saved as MtPreference;
    } catch {
      // Storage unavailable (private window, blocked site data)
    }
    return 'auto';
  });
  const tryDeviceFirst = useDeviceFirstTranslator(mtPreference);
  const mtPreferenceRef = useRef<MtPreference>(mtPreference);
  const [lastUsedProvider, setLastUsedProvider] = useState<TranslatorId | null>(null);
  // How long the most recent translation took, end to end, as measured in the browser
  const [lastTranslateMs, setLastTranslateMs] = useState<number | null>(null);
  // "On this device" never falls back to the server, so a failure there must be visible.
  // True after an on-device failure in that mode, false again after the next success.
  const [onDeviceFailing, setOnDeviceFailing] = useState(false);
  const onDeviceSupported = isOnDeviceTranslationSupported();

  useEffect(() => {
    mtPreferenceRef.current = mtPreference;
    try {
      localStorage.setItem(MT_PREFERENCE_STORAGE_KEY, mtPreference);
    } catch {
      // Ignore storage failures; the choice still applies for this session
    }
  }, [mtPreference]);

  // Fast single-language machine translation (deduped + cached, one quick retry)
  const fetchMT = useCallback(
    (
      text: string,
      lang: ConversationLanguage,
      source: ConversationLanguage = 'en',
      options: { live?: boolean } = {},
    ): Promise<string> => {
      if (source === lang) return Promise.resolve(text);
      const preference = mtPreferenceRef.current;
      // Live (still-being-spoken) text only ever uses this device or the free endpoint, so it
      // can't spend money. It has its own cache entries; a finished line still reuses a matching
      // live request, and makes its own full request only if that one fails.
      const live = options.live === true;
      const finishedKey = mtCacheKey(preference, source, lang, text);
      const liveKey = 'live\u0000' + finishedKey;
      const key = live ? liveKey : finishedKey;
      const existing = cache.get(key);
      if (existing) return existing;
      const reusableLive = live ? undefined : cache.get(liveKey);

      const started = performance.now();
      const recordTiming = () => setLastTranslateMs(Math.round(performance.now() - started));

      const attemptServer = async (): Promise<string> => {
        // The user can switch to local-only while an automatic request waits for a pack.
        if (preference !== mtPreferenceRef.current) throw new DOMException('Translator changed', 'AbortError');
        const res = await fetch('/api/mt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [SESSION_HEADER]: getSessionId(),
          },
          body: JSON.stringify({
            text,
            lang,
            source,
            ...(preference === 'auto' || preference === 'on-device'
              ? {}
              : { provider: preference }),
            ...(live ? { freeOnly: true } : {}),
          } satisfies MtRequestBody),
        });
        if (res.status === 429) throw new RateLimitedError();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Partial<MtSuccessResponse>;
        if (!data.translation) throw new Error('Missing translation');
        if (data.provider && data.provider !== 'cache') {
          setLastUsedProvider(data.provider);
        }
        recordTiming();
        return data.translation;
      };

      const attempt = async (): Promise<string> => {
        const forced = preference === 'on-device' && isOnDeviceTranslationSupported();
        if (forced || preference === 'auto') {
          const t0 = performance.now();
          try {
            const translation = forced
              ? await translateOnDevice(text, lang, source, ON_DEVICE_TIMEOUT_MS)
              : await tryDeviceFirst(text, lang, source);
            if (translation === null) return attemptServer();
            const ms = Math.round(performance.now() - t0);
            console.info(`[on-device] ${lang}: ${ms} ms${overBy(ms)}`);
            setLastUsedProvider('on-device');
            if (forced) setOnDeviceFailing(false);
            recordTiming();
            return translation;
          } catch (error) {
            if (forced) {
              const ms = Math.round(performance.now() - t0);
              console.warn(
                `[on-device] ${lang}: failed after ${ms} ms; not using online translation —`,
                error instanceof Error ? error.message : error
              );
              setOnDeviceFailing(true);
            }
            throw error;
          }
        }
        return attemptServer();
      };

      const run = () =>
        attempt().catch(async (error) => {
          // Throttled: retrying straight away would only add load
          if (error instanceof RateLimitedError || (error instanceof DOMException && error.name === 'AbortError') ||
              preference !== mtPreferenceRef.current) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
          return attempt();
        });
      return cache.store(key, reusableLive ? reusableLive.catch(run) : run());
    },
    [cache, tryDeviceFirst]
  );

  // A saved choice for a translator the server no longer offers behaves like Auto
  const effectiveMtPreference: MtPreference =
    mtPreference === 'on-device'
      ? onDeviceSupported
        ? 'on-device'
        : 'auto'
      : mtPreference !== 'auto' &&
          availableProviders.length > 0 &&
          !availableProviders.includes(mtPreference)
        ? 'auto'
        : mtPreference;

  return {
    fetchMT, mtPreference, effectiveMtPreference, setMtPreference,
    mtPreferenceRef, onDeviceSupported, lastUsedProvider, lastTranslateMs,
    onDeviceFailing,
  };
}
