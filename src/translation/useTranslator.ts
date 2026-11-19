import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTO_ON_DEVICE_TIMEOUT_MS, MT_CLIENT_CACHE_MAX, MT_PREFERENCE_STORAGE_KEY, MT_PROVIDER_LABELS,
  ON_DEVICE_TIMEOUT_MS, mtCacheKey, overBy,
  type MtPreference, type MtProviderId, type TranslatorId,
} from '../app/settings';
import { RateLimitedError } from '../http';
import { isOnDeviceTranslationSupported, isOnDeviceUsable, translateOnDevice } from '../onDevice';
import { getSessionId, SESSION_HEADER } from '../session';
import type { ConversationLanguage, LanguageCode } from '../types';

export function useTranslator(availableProviders: MtProviderId[]) {
  // Fast MT: in-flight + resolved translations keyed by `${lang}\u0000${text}`.
  // Sharing promises means the final sentence reuses an interim request that's still running.
  const mtCacheRef = useRef<Map<string, Promise<string>>>(new Map());

  // Translator picker: 'auto' uses the server's default order; anything else goes first
  const [mtPreference, setMtPreference] = useState<MtPreference>(() => {
    try {
      const saved = localStorage.getItem(MT_PREFERENCE_STORAGE_KEY);
      if (saved && saved in MT_PROVIDER_LABELS) return saved as MtPreference;
    } catch {
      // Storage unavailable (private window, blocked site data)
    }
    return 'auto';
  });
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
      const cache = mtCacheRef.current;
      const existing = cache.get(key);
      if (existing) return existing;
      const reusableLive = live ? undefined : cache.get(liveKey);

      const started = performance.now();
      const recordTiming = () => setLastTranslateMs(Math.round(performance.now() - started));

      const attemptServer = async (): Promise<string> => {
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
          }),
        });
        if (res.status === 429) throw new RateLimitedError();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          translation?: string;
          provider?: MtProviderId | 'cache';
        };
        if (!data.translation) throw new Error('Missing translation');
        if (data.provider && data.provider !== 'cache') {
          setLastUsedProvider(data.provider);
        }
        recordTiming();
        return data.translation;
      };

      // "On this device" is strict: it never sends text to the server, so it can't spend money
      // or quietly use an online translator. Auto uses this device whenever the language pack
      // is already installed, and the server's chain (free endpoint, then Cloud Translation,
      // when it has a key) for anything it can't do. A browser without the Translator API treats
      // "On this device" as Auto, matching `effectiveMtPreference`.
      const attempt = async (): Promise<string> => {
        const forced = preference === 'on-device' && isOnDeviceTranslationSupported();
        const useOnDevice =
          forced || (preference === 'auto' && (await isOnDeviceUsable(lang, source)));
        if (useOnDevice) {
          const t0 = performance.now();
          try {
            const translation = await translateOnDevice(
              text,
              lang,
              source,
              forced ? ON_DEVICE_TIMEOUT_MS : AUTO_ON_DEVICE_TIMEOUT_MS
            );
            const ms = Math.round(performance.now() - t0);
            console.info(`[on-device] ${lang}: ${ms} ms${overBy(ms)}`);
            setLastUsedProvider('on-device');
            if (forced) setOnDeviceFailing(false);
            recordTiming();
            return translation;
          } catch (error) {
            // Unsupported language, model not ready yet, blocked by policy, or too slow
            if (forced) {
              const ms = Math.round(performance.now() - t0);
              console.warn(
                `[on-device] ${lang}: failed after ${ms} ms; not using online translation —`,
                error instanceof Error ? error.message : error
              );
              setOnDeviceFailing(true);
              throw error;
            }
          }
        }
        return attemptServer();
      };

      const run = () =>
        attempt().catch(async (error) => {
          // Throttled: retrying straight away would only add load
          if (error instanceof RateLimitedError) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
          return attempt();
        });
      const promise = reusableLive ? reusableLive.catch(run) : run();
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
      if (cache.size > MT_CLIENT_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return promise;
    },
    []
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
