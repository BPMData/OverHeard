import { AUTO_ON_DEVICE_TIMEOUT_MS, rejectAfter } from '../app/settings';
import { getOnDeviceAvailability, translateOnDevice } from '../onDevice';
import type { ConversationLanguage } from '../types';

const DOWNLOAD_GRACE_MS = 10_000;
const RECOVERY_INTERVAL_MS = 30_000;

// Use the actual source language for two-way conversations. These samples stay on the device.
const samples: Record<ConversationLanguage, string[]> = {
  en: ['Hello.', 'Open the book.', 'Thank you.'],
  es: ['Hola.', 'Abre el libro.', 'Gracias.'],
  pt: ['Olá.', 'Abra o livro.', 'Obrigado.'],
  ar: ['مرحبًا.', 'افتح الكتاب.', 'شكرًا.'],
  zh: ['你好。', '请打开书。', '谢谢。'],
  vi: ['Xin chào.', 'Hãy mở sách.', 'Cảm ơn.'],
  ht: ['Bonjou.', 'Louvri liv la.', 'Mèsi.'],
  fr: ['Bonjour.', 'Ouvre le livre.', 'Merci.'],
  uk: ['Привіт.', 'Відкрий книжку.', 'Дякую.'],
  ru: ['Привет.', 'Открой книгу.', 'Спасибо.'],
  so: ['Salaan.', 'Fur buugga.', 'Mahadsanid.'],
  prs: ['سلام.', 'کتاب را باز کنید.', 'تشکر.'],
  ps: ['سلام.', 'کتاب خلاص کړئ.', 'مننه.'],
};

interface Pair {
  lastUsed: number;
  download?: Promise<boolean>;
  recovering: boolean;
  checking: boolean;
  nextCheck: number;
  timer?: ReturnType<typeof setTimeout>;
}

export function createDeviceFirstTranslator() {
  const pairs = new Map<string, Pair>();

  function queueCheck(pair: Pair, target: ConversationLanguage, source: ConversationLanguage) {
    const key = source + '>' + target;
    if (pair.timer !== undefined || pair.checking || pairs.get(key) !== pair) return;
    pair.timer = setTimeout(async () => {
      pair.timer = undefined;
      pair.checking = true;
      try {
        if (await rejectAfter(getOnDeviceAvailability(target, source), AUTO_ON_DEVICE_TIMEOUT_MS) === 'available') {
          for (const sample of samples[source]) {
            if (pairs.get(key) !== pair) return;
            const value = await translateOnDevice(sample, target, source, AUTO_ON_DEVICE_TIMEOUT_MS, { waitForSetup: false });
            if (!value.trim()) return;
          }
          pair.recovering = false;
        }
      } catch {
        // Continue serving captions online until a full local check succeeds.
      } finally {
        pair.checking = false;
        pair.nextCheck = Date.now() + RECOVERY_INTERVAL_MS;
        if (pair.recovering && Date.now() - pair.lastUsed < RECOVERY_INTERVAL_MS) {
          queueCheck(pair, target, source);
        }
      }
    }, Math.max(0, pair.nextCheck - Date.now()));
  }

  // Share one grace period across captions for a downloading pair. Once it expires,
  // later captions can use the fallback immediately until the browser reports the pack ready.
  async function waitForDownload(key: string, pair: Pair, target: ConversationLanguage, source: ConversationLanguage) {
    const deadline = Date.now() + DOWNLOAD_GRACE_MS;
    while (pairs.get(key) === pair && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
      const remaining = Math.max(0, deadline - Date.now());
      const status = await rejectAfter(getOnDeviceAvailability(target, source), remaining);
      if (status !== 'downloading') return status === 'available';
    }
    return false;
  }

  async function tryPair(pair: Pair, key: string, text: string, target: ConversationLanguage, source: ConversationLanguage) {
    if (pair.recovering) {
      // Resume checks immediately if this pair has been idle since the last one.
      queueCheck(pair, target, source);
      return null;
    }
    try {
      const status = await rejectAfter(getOnDeviceAvailability(target, source), AUTO_ON_DEVICE_TIMEOUT_MS);
      if (status === 'downloading') {
        pair.download ??= waitForDownload(key, pair, target, source);
        if (!await pair.download) return null;
      } else {
        pair.download = undefined;
        if (status !== 'available') return null;
      }
      if (pairs.get(key) !== pair || pair.recovering) return null;
      const value = await translateOnDevice(text, target, source, AUTO_ON_DEVICE_TIMEOUT_MS, { waitForSetup: false });
      if (!value.trim()) throw new Error('Empty local translation');
      return value;
    } catch {
      if (!pair.recovering) pair.nextCheck = Date.now() + RECOVERY_INTERVAL_MS;
      pair.recovering = true;
      queueCheck(pair, target, source);
      return null;
    }
  }

  async function translate(text: string, target: ConversationLanguage, source: ConversationLanguage = 'en') {
    const key = source + '>' + target;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { lastUsed: Date.now(), recovering: false, checking: false, nextCheck: 0 };
      pairs.set(key, pair);
    }
    pair.lastUsed = Date.now();
    const value = await tryPair(pair, key, text, target, source);
    // A language/preference change can retire this request during the download grace period.
    if (pairs.get(key) !== pair) throw new DOMException('Translator changed', 'AbortError');
    return value;
  }

  function reset() {
    for (const pair of pairs.values()) clearTimeout(pair.timer);
    pairs.clear();
  }

  return { translate, reset };
}
