import type { createDeviceFirstTranslator } from '../translation/deviceFirst';
import { getSessionId, SESSION_HEADER } from '../session';
import type { LanguageCode } from '../types';

// Each browser shares its own pending/completed local work. Server requests are also
// coalesced across students by the machine translator, including provider fallbacks.
/** `onTranslated` hears who did each fresh translation, so the page can show it. */
export function createStudentTranslator(
  tryDeviceFirst: ReturnType<typeof createDeviceFirstTranslator>['translate'],
  onTranslated?: (by: 'on-device' | 'gtx') => void,
) {
  const cache = new Map<string, Promise<string>>();
  return (text: string, lang: LanguageCode): Promise<string> => {
    const key = `${lang}\0${text}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const local = await tryDeviceFirst(text, lang, 'en');
      if (local !== null) {
        onTranslated?.('on-device');
        return local;
      }
      const response = await fetch('/api/mt', { method: 'POST',
        headers: { 'Content-Type': 'application/json', [SESSION_HEADER]: getSessionId() },
        // Students never use the paid translator: on-device first, then the free endpoint only
        body: JSON.stringify({ text, lang, source: 'en', provider: 'gtx', freeOnly: true }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Translation unavailable.');
      const data = await response.json();
      if (typeof data.translation !== 'string' || !data.translation) throw new Error('Missing translation.');
      onTranslated?.('gtx');
      return data.translation;
    })();
    cache.set(key, pending);
    void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    if (cache.size > 2500) cache.delete(cache.keys().next().value!);
    return pending;
  };
}
