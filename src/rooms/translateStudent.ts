import type { createDeviceFirstTranslator } from '../translation/deviceFirst';
import { ON_DEVICE_TIMEOUT_MS } from '../app/settings';
import { translateOnDevice } from '../onDevice';
import { getSessionId, SESSION_HEADER } from '../session';
import { createTranslationCache } from '../translation/translationCache';
import type { MtRequestBody, MtSuccessResponse } from '../translation/protocol';
import type { LanguageCode } from '../types';

// Each browser shares its own pending/completed local work. Server requests are also
// coalesced across students by the machine translator, including provider fallbacks.
/**
 * `onTranslated` hears who did each fresh translation, so the page can show it. With
 * `onDeviceOnly` (the student's own choice) nothing is ever sent to an online translator.
 */
export function createStudentTranslator(
  tryDeviceFirst: ReturnType<typeof createDeviceFirstTranslator>['translate'],
  onTranslated?: (by: 'on-device' | 'gtx') => void,
  { onDeviceOnly = false }: { onDeviceOnly?: boolean } = {},
) {
  const cache = createTranslationCache(2500);
  return (text: string, lang: LanguageCode): Promise<string> => {
    const key = `${lang}\0${text}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async () => {
      if (onDeviceOnly) {
        const value = await translateOnDevice(text, lang, 'en', ON_DEVICE_TIMEOUT_MS);
        if (!value.trim()) throw new Error('Empty local translation');
        onTranslated?.('on-device');
        return value;
      }
      const local = await tryDeviceFirst(text, lang, 'en');
      if (local !== null) {
        onTranslated?.('on-device');
        return local;
      }
      const response = await fetch('/api/mt', { method: 'POST',
        headers: { 'Content-Type': 'application/json', [SESSION_HEADER]: getSessionId() },
        // Students never use the paid translator: on-device first, then the free endpoint only
        body: JSON.stringify({ text, lang, source: 'en', provider: 'gtx', freeOnly: true } satisfies MtRequestBody), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Translation unavailable.');
      const data: Partial<MtSuccessResponse> = await response.json();
      if (typeof data.translation !== 'string' || !data.translation) throw new Error('Missing translation.');
      onTranslated?.('gtx');
      return data.translation;
    })();
    return cache.store(key, pending);
  };
}
