// On-device mode: Chrome's built-in Translator API and on-device speech recognition.
// Nothing here talks to a server. Callers fall back to the cloud path when something
// isn't available (unsupported browser, unsupported language, blocked by policy).

import { AUTO_ON_DEVICE_TIMEOUT_MS, rejectAfter } from './app/settings';
import { speechLocale } from './conversation/locales';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}

interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

interface SpeechRecognitionStatic {
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (opts: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  // Older names used by some Chrome builds
  availableOnDevice?: (lang: string) => Promise<Availability>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

// Read through `unknown` so this compiles whether or not the TS DOM lib declares these yet
const browserGlobals = () =>
  globalThis as unknown as {
    Translator?: TranslatorStatic;
    SpeechRecognition?: SpeechRecognitionStatic;
    webkitSpeechRecognition?: SpeechRecognitionStatic;
  };

const getTranslatorApi = (): TranslatorStatic | null => browserGlobals().Translator ?? null;

const getSpeechApi = (): SpeechRecognitionStatic | null =>
  browserGlobals().SpeechRecognition ?? browserGlobals().webkitSpeechRecognition ?? null;

export const isOnDeviceTranslationSupported = (): boolean => getTranslatorApi() !== null;

// Chrome's Translator uses BCP 47 codes; ours match except Dari.
const TRANSLATOR_CODES: Record<string, string> = { prs: 'fa-AF' };
const toTranslatorCode = (code: string) => TRANSLATOR_CODES[code] ?? code;

const translators = new Map<string, Promise<TranslatorInstance | null>>();
// Remember ready models. Recheck unavailable pairs occasionally in case browser support changes.
const readyPairs = new Set<string>();
const unavailableUntil = new Map<string, number>();
const UNAVAILABLE_RECHECK_MS = 30_000;

/** Download progress for a language: 0–1 while downloading, null when it ended without a pack. */
export type PackProgress = (code: string, fraction: number | null) => void;

/** Chrome reports `loaded` as a 0–1 fraction; older builds reported bytes with a `total`. */
export function progressFraction(event: { loaded: number; total?: number }): number {
  const fraction =
    event.total && event.total > 1 ? event.loaded / event.total : event.loaded;
  return Math.min(Math.max(fraction, 0), 1);
}

const AVAILABILITY_POLL_MS = 2000;
const STALLED_PROGRESS_MS = 4000;

/**
 * Get (and, if needed, download) the on-device translator for `source` → `code`.
 * Resolves to null when the language isn't supported on this device.
 * The first call that triggers a download must come from a click or key press.
 */
export function getOnDeviceTranslator(
  code: string,
  sourceOrProgress: string | PackProgress = 'en',
  progress?: PackProgress
): Promise<TranslatorInstance | null> {
  const source = typeof sourceOrProgress === 'string' ? sourceOrProgress : 'en';
  const onProgress = typeof sourceOrProgress === 'function' ? sourceOrProgress : progress;
  const key = `${source}>${code}`;
  const existing = translators.get(key);
  if (existing) return existing;

  const api = getTranslatorApi();
  const promise: Promise<TranslatorInstance | null> = (async () => {
    if (!api) return null;
    const langs = { sourceLanguage: toTranslatorCode(source), targetLanguage: toTranslatorCode(code) };
    const availability = await rejectAfter(api.availability(langs), AUTO_ON_DEVICE_TIMEOUT_MS);
    if (availability === 'unavailable') return null;
    if (availability === 'available') return rejectAfter(api.create(langs), AUTO_ON_DEVICE_TIMEOUT_MS);

    onProgress?.(code, 0);
    let sawProgress = false;
    let settled = false;
    const startedAt = Date.now();

    const createPromise = api.create({
      ...langs,
      monitor: (m) =>
        m.addEventListener('downloadprogress', (e) => {
          if (settled) return;
          const fraction = progressFraction(e as unknown as { loaded: number; total?: number });
          if (fraction > 0) sawProgress = true;
          onProgress?.(code, fraction);
        }),
    });

    return await new Promise<TranslatorInstance | null>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(pollTimer);
        fn();
      };

      const pollTimer = setInterval(() => {
        if (settled) return;
        void api.availability(langs).then(
          (status) => {
            if (settled) return;
            if (status === 'available') {
              // Chrome can finish downloading the pack in the background without resolving
              // the original create()/downloadprogress call; create a ready instance now.
              void api.create(langs).then(
                (instance) => finish(() => resolve(instance)),
                () => {
                  /* Wait for the original createPromise or next poll tick. */
                }
              );
            } else if (status === 'unavailable') {
              finish(() => resolve(null));
            } else if (!sawProgress && Date.now() - startedAt >= STALLED_PROGRESS_MS) {
              sawProgress = true;
              onProgress?.(code, -1);
            }
          },
          () => {
            /* Ignore transient availability errors while create() is pending. */
          }
        );
      }, AVAILABILITY_POLL_MS);

      createPromise.then(
        (instance) => finish(() => resolve(instance)),
        (err) => finish(() => reject(err))
      );
    });
  })();

  translators.set(key, promise);
  // Don't cache failures (e.g. a download that needed a user gesture); try again next time
  promise.then(
    (translator) => {
      if (translators.get(key) !== promise) return;
      if (translator) {
        readyPairs.add(key);
        unavailableUntil.delete(key);
      } else {
        translators.delete(key);
        unavailableUntil.set(key, Date.now() + UNAVAILABLE_RECHECK_MS);
      }
    },
    () => { if (translators.get(key) === promise) translators.delete(key); }
  );
  return promise;
}

/**
 * Start downloading language packs for these languages. Call from a click handler.
 * `onProgress` gets 0–1 while downloading, 1 when ready, and null if a language can't run here.
 */
export function prepareOnDeviceTranslators(
  codes: string[],
  sourceOrProgress: string | PackProgress = 'en',
  progress?: PackProgress
): void {
  const source = typeof sourceOrProgress === 'string' ? sourceOrProgress : 'en';
  const onProgress = typeof sourceOrProgress === 'function' ? sourceOrProgress : progress;
  for (const code of codes) {
    getOnDeviceTranslator(code, source, onProgress).then(
      (translator) => onProgress?.(code, translator ? 1 : null),
      () => onProgress?.(code, null)
    );
  }
}

/** Reports an installation started in this tab even before Chrome updates its availability. */
export async function getOnDeviceAvailability(code: string, source = 'en'): Promise<Availability> {
  const api = getTranslatorApi();
  if (!api) return 'unavailable';
  const key = `${source}>${code}`;
  if (readyPairs.has(key)) return 'available';
  if ((unavailableUntil.get(key) ?? 0) > Date.now()) return 'unavailable';
  try {
    const availability = await api.availability({
      sourceLanguage: toTranslatorCode(source),
      targetLanguage: toTranslatorCode(code),
    });
    if (availability === 'unavailable') {
      unavailableUntil.set(key, Date.now() + UNAVAILABLE_RECHECK_MS);
      return 'unavailable';
    }
    return availability === 'downloadable' && translators.has(key) ? 'downloading' : availability;
  } catch {
    return 'unavailable';
  }
}

export class OnDeviceUnavailableError extends Error {}

/**
 * Forget the cached translator for `source` → `code` and destroy it (which also cancels its
 * queued work), so the next call creates a fresh one. A translator can stop working while the
 * page stays open (e.g. Chrome restarts its translation service); a cached dead instance would
 * otherwise fail every later request in this tab, while other tabs that create a new one work.
 */
export function discardOnDeviceTranslator(code: string, source = 'en'): void {
  const key = `${source}>${code}`;
  const cached = translators.get(key);
  if (!cached) return;
  translators.delete(key);
  readyPairs.delete(key);
  void cached.then(
    (translator) => {
      try {
        translator?.destroy?.();
      } catch {
        // Already gone
      }
    },
    () => {},
  );
}

/**
 * Translate on this device. On an error, or when `timeoutMs` passes first, the translator is
 * discarded (see `discardOnDeviceTranslator`) and the promise rejects; callers fall back online.
 */
export async function translateOnDevice(
  text: string,
  code: string,
  source = 'en',
  timeoutMs?: number,
  { waitForSetup = true } = {},
): Promise<string> {
  // Explicit local-only mode can wait for a user-initiated download. The automatic
  // path already gave the pack a grace period, so setup counts toward its deadline.
  const started = Date.now();
  const pending = getOnDeviceTranslator(code, source);
  const translator = waitForSetup || timeoutMs === undefined
    ? await pending
    : await rejectAfter(pending, timeoutMs);
  if (!translator) {
    throw new OnDeviceUnavailableError(`No on-device translator for ${code}`);
  }
  try {
    const work = translator.translate(text);
    if (timeoutMs === undefined) return await work;
    const remaining = waitForSetup ? timeoutMs : Math.max(0, timeoutMs - (Date.now() - started));
    return await rejectAfter(work, remaining);
  } catch (error) {
    // Only discard the instance that failed, not a fresh one another call already made
    const key = `${source}>${code}`;
    if (translators.get(key) === pending) discardOnDeviceTranslator(code, source);
    throw error;
  }
}

/**
 * Make sure on-device English speech recognition is ready, downloading it if needed.
 * Returns true if recognition can run locally. Call from a click handler (install needs one).
 */
async function prepareSpeechUncached(
  lang: string,
  onDownloadStart?: () => void
): Promise<boolean> {
  const api = getSpeechApi();
  if (!api) return false;
  try {
    if (api.available && api.install) {
      const opts = { langs: [lang], processLocally: true };
      const status = await api.available(opts);
      if (status === 'available') return true;
      if (status === 'unavailable') return false;
      onDownloadStart?.();
      return await api.install(opts);
    }
    if (api.availableOnDevice && api.installOnDevice) {
      const status = await api.availableOnDevice(lang);
      if (status === 'available') return true;
      if (status === 'unavailable') return false;
      onDownloadStart?.();
      return await api.installOnDevice(lang);
    }
  } catch {
    // Treat any error (policy block, missing gesture, ChromeOS) as "not available"
  }
  return false;
}

// Preparations still running, so a second caller (e.g. the first conversation turn, started
// while the Start click is still downloading the pack) shares them instead of installing twice.
const speechPreparations = new Map<string, Promise<boolean>>();

/**
 * Make sure on-device speech recognition for `lang` is ready, downloading it if needed.
 * Returns true if recognition can run locally. Call from a click handler (install needs one).
 */
export function prepareOnDeviceSpeech(
  lang = 'en-US',
  /** Called when a download actually starts (Chrome gives no progress for speech packs) */
  onDownloadStart?: () => void
): Promise<boolean> {
  const running = speechPreparations.get(lang);
  if (running) return running;
  const promise = prepareSpeechUncached(lang, onDownloadStart);
  speechPreparations.set(lang, promise);
  // Only in-flight work is shared; a finished result is re-checked next time
  const done = () => speechPreparations.delete(lang);
  promise.then(done, done);
  return promise;
}

/**
 * Start every on-device download a conversation needs: translation in both directions and a
 * speech pack for each side's language.
 *
 * Call this straight from the Start click. Chrome only allows these downloads during a user
 * gesture, and the automatic hand-off between speakers isn't one, so a pack left for later
 * would never install. Everything starts at once, so no download sits waiting for another
 * until the gesture has expired.
 *
 * Progress keys: translation packs are keyed by target language, speech packs `speech:<code>`.
 * Pass `{ speech: false }` to fetch only the translation packs (Auto mode keeps cloud speech).
 */
export function prepareOnDeviceConversation(
  langs: { a: string; b: string },
  onProgress?: PackProgress,
  options: { speech?: boolean } = {}
): void {
  if (langs.a !== langs.b) {
    prepareOnDeviceTranslators([langs.b], langs.a, onProgress);
    prepareOnDeviceTranslators([langs.a], langs.b, onProgress);
  }
  if (options.speech === false) return;
  for (const code of new Set([langs.a, langs.b])) {
    const key = `speech:${code}`;
    void prepareOnDeviceSpeech(speechLocale(code), () => onProgress?.(key, -1)).then(() =>
      onProgress?.(key, null)
    );
  }
}
