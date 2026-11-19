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
  // Which translator produced each cached result, so the Gemini clean-up can skip anything
  // that was translated on this device
  const mtProviderRef = useRef<Map<string, TranslatorId>>(new Map());

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
  const onDeviceSupported = isOnDeviceTranslationSupported();

  useEffect(() => {
    mtPreferenceRef.current = mtPreference;
    try {
      localStorage.setItem(MT_PREFERENCE_STORAGE_KEY, mtPreference);
    } catch {
      // Ignore storage failures; the choice still applies for this session
    }
  }, [mtPreference]);

  // Low-level fetch with 1-second single retry
  const fetchTranslationWithRetry = useCallback(
    async (
      phrase: string,
      targetLangs: LanguageCode[],
      context: string[]
    ): Promise<Record<string, string>> => {
      const attemptFetch = async (): Promise<Record<string, string>> => {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [SESSION_HEADER]: getSessionId(),
          },
          body: JSON.stringify({
            phrase: phrase.slice(0, 500),
            targetLangs,
            context,
          }),
        });
        if (res.status === 429) throw new RateLimitedError();
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          translations?: Record<string, string>;
        };
        if (!data.translations) {
          throw new Error('Missing translations payload');
        }
        return data.translations;
      };

      try {
        return await attemptFetch();
      } catch (error) {
        // Throttled: retrying straight away would only add load
        if (error instanceof RateLimitedError) throw error;
        // Retry once after 1 second before giving up
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await attemptFetch();
      }
    },
    []
  );

  // Fast single-language machine translation (deduped + cached, one quick retry)
  const fetchMT = useCallback(
    (text: string, lang: ConversationLanguage, source: ConversationLanguage = 'en'): Promise<string> => {
      if (source === lang) return Promise.resolve(text);
      const preference = mtPreferenceRef.current;
      const key = mtCacheKey(preference, source, lang, text);
      const cache = mtCacheRef.current;
      const existing = cache.get(key);
      if (existing) return existing;

      const started = performance.now();
      const recordTiming = () => setLastTranslateMs(Math.round(performance.now() - started));
      const rememberProvider = (provider: TranslatorId) => {
        const providers = mtProviderRef.current;
        providers.set(key, provider);
        if (providers.size > MT_CLIENT_CACHE_MAX) {
          const oldest = providers.keys().next().value;
          if (oldest !== undefined) providers.delete(oldest);
        }
      };

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
          rememberProvider(data.provider);
        }
        recordTiming();
        return data.translation;
      };

      // On this device first: always in "On this device" mode, and in Auto whenever the language
      // pack is already installed. Anything it can't do falls back to the server's chain
      // (free endpoint, then Cloud Translation, then Gemini).
      const attempt = async (): Promise<string> => {
        const forced = preference === 'on-device';
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
            rememberProvider('on-device');
            recordTiming();
            return translation;
          } catch (error) {
            // Unsupported language, model not ready yet, blocked by policy, or too slow
            if (forced) {
              const ms = Math.round(performance.now() - t0);
              console.warn(
                `[on-device] ${lang}: gave up after ${ms} ms, using online translation —`,
                error instanceof Error ? error.message : error
              );
            }
          }
        }
        return attemptServer();
      };

      const promise = attempt().catch(async (error) => {
        // Throttled: retrying straight away would only add load
        if (error instanceof RateLimitedError) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return attempt();
      });
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

  const getMtProvider = useCallback(
    (preference: MtPreference, source: ConversationLanguage, lang: ConversationLanguage, text: string) =>
      mtProviderRef.current.get(mtCacheKey(preference, source, lang, text)),
    [],
  );

  return {
    fetchMT, fetchTranslationWithRetry, mtPreference, effectiveMtPreference, setMtPreference,
    mtPreferenceRef, onDeviceSupported, lastUsedProvider, lastTranslateMs, getMtProvider,
  };
}
