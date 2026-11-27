// On-device mode: Chrome's built-in Translator API, then Bergamot (Firefox Translations, in
// src/translation/bergamot/) where Chrome can't translate a language, and on-device speech
// recognition. No caption text goes to a server here. Callers fall back to the cloud path when
// something isn't available (unsupported browser, unsupported language, blocked by policy).

import { ON_DEVICE_TIMEOUT_MS, rejectAfter } from './app/settings';
import { speechLocale } from './conversation/locales';
import { isOffline } from './offline';
import {
  bergamotAvailability, createBergamotTranslator, downloadBergamotModel, hasBergamotModel,
  isBergamotRunnable, isBergamotTranslator,
} from './translation/bergamot/engine';
import { BERGAMOT_APPROXIMATE, bergamotDownloadLabel } from './translation/bergamot/models';

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

/** Chrome's built-in Translator API is present (it also brings on-device speech in Chrome). */
export const hasChromeTranslator = (): boolean => getTranslatorApi() !== null;

/** Some on-device translator can run here: Chrome's, or Bergamot for the languages it has. */
export const isOnDeviceTranslationSupported = (): boolean => hasChromeTranslator() || isBergamotRunnable();

// Chrome's Translator uses BCP 47 codes; ours match except Dari.
const TRANSLATOR_CODES: Record<string, string> = { prs: 'fa-AF' };
const toTranslatorCode = (code: string) => TRANSLATOR_CODES[code] ?? code;

const translators = new Map<string, Promise<TranslatorInstance | null>>();
// Remember ready models. Recheck unavailable pairs occasionally in case browser support changes.
const readyPairs = new Set<string>();
const unavailableUntil = new Map<string, number>();
const UNAVAILABLE_RECHECK_MS = 30_000;

// Pairs that have produced a working on-device translator (Chrome or Bergamot) on this device.
// Proof beats a check: Chrome's availability() can say "unavailable" or hang while offline (seen
// on Android) even though the installed pack translates fine. Saved so a reload offline knows too.
const WORKED_STORAGE_KEY = 'overheard.onDeviceWorkedPairs';
const workedListeners = new Set<() => void>();
const workedPairs: Set<string> = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(WORKED_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set<string>();
  }
})();
function setWorked(key: string, worked: boolean): void {
  if (workedPairs.has(key) === worked) return;
  if (worked) workedPairs.add(key);
  else workedPairs.delete(key);
  try {
    localStorage.setItem(WORKED_STORAGE_KEY, JSON.stringify([...workedPairs]));
  } catch {
    // Storage blocked: remember for this page only
  }
  for (const listener of workedListeners) listener();
}
/** True once `source` → `code` has translated on this device. */
export const hasOnDeviceWorked = (code: string, source = 'en'): boolean => workedPairs.has(`${source}>${code}`);
/** Called whenever a pair is found working or found missing. Returns an unsubscribe function. */
export function onOnDeviceWorkedChange(listener: () => void): () => void {
  workedListeners.add(listener);
  return () => workedListeners.delete(listener);
}
// Chrome's availability() can hang (e.g. while its translation service starts, or in a browser
// that ships the API without its service). When Bergamot can take over, wait only this long.
const CHROME_CHECK_WITH_FALLBACK_MS = 3000;

/**
 * Download progress for a language: 0–1 while downloading, PACK_NEEDS_CLICK while it waits for
 * a click to start, and null when it ended without a pack.
 */
export type PackProgress = (code: string, fraction: number | null) => void;

/**
 * Chrome lets each click start only one language pack download: create() uses up the click
 * (user activation) when a pack still has to download, so the next pack in the same click is
 * refused with NotAllowedError. Those packs wait here, and the pack panel shows a button for
 * each one; its click starts that download.
 */
export const PACK_NEEDS_CLICK = -2;
const waitingForClick = new Map<string, () => void>();
// Waiting Bergamot downloads. Unlike Chrome's, they don't need the click itself, but each one
// waits for a click on a button that shows its size first, so nothing big downloads unasked.
const waitingBergamot = new Set<string>();

/**
 * For a pack waiting for a click: "34 MB" when it's a Bergamot model (with a note when the model
 * is only an approximation of the language), or null for a Chrome pack, whose size Chrome
 * doesn't publish.
 */
export function waitingPackSize(key: string): { size: string; note?: string } | null {
  if (!waitingBergamot.has(key)) return null;
  return { size: bergamotDownloadLabel(key), note: BERGAMOT_APPROXIMATE[key] };
}

/** Start a pack download that is waiting for a click. Call it straight from the click handler. */
export function startWaitingPack(key: string): void {
  const start = waitingForClick.get(key);
  waitingForClick.delete(key);
  waitingBergamot.delete(key);
  start?.();
}

const isNotAllowed = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'NotAllowedError';

/** Chrome reports `loaded` as a 0–1 fraction; older builds reported bytes with a `total`. */
export function progressFraction(event: { loaded: number; total?: number }): number {
  const fraction =
    event.total && event.total > 1 ? event.loaded / event.total : event.loaded;
  return Math.min(Math.max(fraction, 0), 1);
}

const destroyQuietly = (translator: TranslatorInstance | null | undefined) => {
  try {
    translator?.destroy?.();
  } catch {
    // Already gone
  }
};

/** Caps setup time. A translator that arrives after the cap is destroyed instead of leaking its model. */
function createWithin(
  api: TranslatorStatic,
  langs: { sourceLanguage: string; targetLanguage: string },
  ms: number
): Promise<TranslatorInstance> {
  const created = api.create(langs);
  return rejectAfter(created, ms).catch((error) => {
    void created.then(destroyQuietly, () => {});
    throw error;
  });
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
    let chrome: TranslatorInstance | null = null;
    const fallback = hasBergamotModel(code, source);
    // Chrome recently said no (or didn't answer): go straight to Bergamot
    const skipChrome = fallback && (unavailableUntil.get(key) ?? 0) > Date.now();
    try {
      chrome = api && !skipChrome
        ? await getChromeTranslator(api, code, source, onProgress, fallback ? CHROME_CHECK_WITH_FALLBACK_MS : ON_DEVICE_TIMEOUT_MS)
        : null;
    } catch (error) {
      if (!fallback) throw error;
      unavailableUntil.set(key, Date.now() + UNAVAILABLE_RECHECK_MS);
    }
    return chrome ?? getBergamotTranslator(code, source, onProgress);
  })();

  translators.set(key, promise);
  // Don't cache failures (e.g. a download that needed a user gesture); try again next time
  promise.then(
    (translator) => {
      if (translators.get(key) !== promise) return;
      if (translator) {
        // readyPairs and unavailableUntil describe Chrome's translator only
        if (!isBergamotTranslator(translator)) readyPairs.add(key);
        unavailableUntil.delete(key);
        setWorked(key, true);
      } else {
        translators.delete(key);
        // No translator: the pack is gone. Not trusted offline, where Chrome's check misreports.
        if (!isOffline()) setWorked(key, false);
        unavailableUntil.set(key, Date.now() + UNAVAILABLE_RECHECK_MS);
      }
    },
    () => { if (translators.get(key) === promise) translators.delete(key); }
  );
  return promise;
}

/**
 * Bergamot for `source` → `code` when Chrome can't: ready at once when the model is saved.
 * A model that isn't saved waits for a click on its download button (PACK_NEEDS_CLICK), which
 * shows the size first; without `onProgress` nobody can be asked, so this resolves to null.
 */
async function getBergamotTranslator(
  code: string,
  source: string,
  onProgress?: PackProgress,
): Promise<TranslatorInstance | null> {
  if (!hasBergamotModel(code, source)) return null;
  const status = await bergamotAvailability(code, source);
  if (status === 'available') return createBergamotTranslator(code, source);
  const report = (fraction: number) => onProgress?.(code, fraction);
  if (status === 'downloading') {
    report(0);
    await downloadBergamotModel(code, report);
    return createBergamotTranslator(code, source);
  }
  if (status !== 'downloadable' || !onProgress) return null;
  return new Promise<TranslatorInstance>((resolve, reject) => {
    const start = () => {
      report(0);
      downloadBergamotModel(code, report)
        .then(() => createBergamotTranslator(code, source))
        .then(resolve, reject);
    };
    waitingForClick.set(code, start);
    waitingBergamot.add(code);
    onProgress(code, PACK_NEEDS_CLICK);
  });
}

/** Chrome's translator for `source` → `code`, or null when Chrome can't translate this pair. */
async function getChromeTranslator(
  api: TranslatorStatic,
  code: string,
  source: string,
  onProgress: PackProgress | undefined,
  checkMs: number,
): Promise<TranslatorInstance | null> {
  const langs = { sourceLanguage: toTranslatorCode(source), targetLanguage: toTranslatorCode(code) };
  // These caps use the strict mode's budget. Auto callers apply their own shorter deadline.
  const availability = await rejectAfter(api.availability(langs), checkMs);
  if (availability === 'unavailable') return null;
  if (availability === 'available') return createWithin(api, langs, ON_DEVICE_TIMEOUT_MS);

  onProgress?.(code, 0);
  let sawProgress = false;
  let settled = false;
  let waiting = false;
  let startedAt = Date.now();

  const createWithMonitor = () => api.create({
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
      if (waitingForClick.get(code) === resume) waitingForClick.delete(code);
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
              (instance) => (settled ? destroyQuietly(instance) : finish(() => resolve(instance))),
              () => {
                /* Wait for the original createPromise or next poll tick. */
              }
            );
          } else if (status === 'unavailable') {
            finish(() => resolve(null));
          } else if (!waiting && !sawProgress && Date.now() - startedAt >= STALLED_PROGRESS_MS) {
            sawProgress = true;
            onProgress?.(code, -1);
          }
        },
        () => {
          /* Ignore transient availability errors while create() is pending. */
        }
      );
    }, AVAILABILITY_POLL_MS);

    // A poll may have created the instance first. Destroy whichever one loses.
    const begin = () =>
      createWithMonitor().then(
        (instance) => (settled ? destroyQuietly(instance) : finish(() => resolve(instance))),
        (err) => {
          if (settled) return;
          if (!isNotAllowed(err)) {
            finish(() => reject(err));
            return;
          }
          // Another pack took this click. Wait for a click of its own (see PACK_NEEDS_CLICK).
          waiting = true;
          onProgress?.(code, PACK_NEEDS_CLICK);
          waitingForClick.set(code, resume);
        }
      );
    function resume() {
      if (settled) return;
      waiting = false;
      sawProgress = false;
      startedAt = Date.now();
      onProgress?.(code, 0);
      begin();
    }
    begin();
  });
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

/**
 * Whether `source` → `code` can be translated on this device: by Chrome when it can, otherwise
 * by Bergamot ('downloadable' until its model is saved).
 */
export async function getOnDeviceAvailability(code: string, source = 'en'): Promise<Availability> {
  if (hasOnDeviceWorked(code, source)) return 'available';
  if (!hasBergamotModel(code, source)) return getChromeAvailability(code, source);
  const chrome = await rejectAfter(getChromeAvailability(code, source), CHROME_CHECK_WITH_FALLBACK_MS).catch(() => {
    unavailableUntil.set(`${source}>${code}`, Date.now() + UNAVAILABLE_RECHECK_MS);
    return 'unavailable' as const;
  });
  if (chrome !== 'unavailable') return chrome;
  return bergamotAvailability(code, source).catch(() => 'unavailable' as const);
}

/**
 * Chrome's translator only. Reports an installation started in this tab even before Chrome
 * updates its availability.
 */
export async function getChromeAvailability(code: string, source = 'en'): Promise<Availability> {
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
  void cached.then(destroyQuietly, () => {});
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
// Locales whose pack has been found ready. Recognition restarts often (Android ends a session
// after every pause), and re-asking Chrome each time delays the next words or, when its check
// hangs, stops them altogether. A pack doesn't disappear mid-conversation.
const readySpeech = new Set<string>();
/** Forget which speech packs were found ready, so the next start checks again. */
export function forgetReadySpeech(): void {
  readySpeech.clear();
}

/**
 * Make sure on-device speech recognition for `lang` is ready, downloading it if needed.
 * Returns true if recognition can run locally. Call from a click handler (install needs one).
 */
export function prepareOnDeviceSpeech(
  lang = 'en-US',
  /** Called when a download actually starts (Chrome gives no progress for speech packs) */
  onDownloadStart?: () => void
): Promise<boolean> {
  if (readySpeech.has(lang)) return Promise.resolve(true);
  const running = speechPreparations.get(lang);
  if (running) return running;
  const promise = prepareSpeechUncached(lang, onDownloadStart);
  speechPreparations.set(lang, promise);
  // Only in-flight work is shared; a missing pack is re-checked next time
  promise.then((ready) => {
    if (ready) readySpeech.add(lang);
  }, () => {});
  const done = () => speechPreparations.delete(lang);
  promise.then(done, done);
  return promise;
}

/**
 * Auto: fetch on-device speech packs so speech can switch over when offline, but only once
 * every translation pack is ready. A speech install made now could take the click a
 * translation pack needs (see PACK_NEEDS_CLICK); speech packs can wait for a later Start.
 * Call from a click handler.
 */
export function prepareOfflineSpeechIfTranslatorsReady(
  pairs: ReadonlyArray<{ code: string; source: string }>,
  /** Speech packs to fetch: the pack panel key ('speech' or 'speech:<code>') and the locale */
  speech: ReadonlyArray<{ key: string; locale: string }>,
  onProgress?: PackProgress
): void {
  // Only Chrome's packs need the click itself; Bergamot downloads don't take it.
  void Promise.all(pairs.map(({ code, source }) => getChromeAvailability(code, source)))
    .then((statuses) => {
      if (!statuses.every((status) => status === 'available' || status === 'unavailable')) return;
      for (const { key, locale } of speech) {
        void prepareOnDeviceSpeech(locale, () => onProgress?.(key, -1)).then(() =>
          onProgress?.(key, null)
        );
      }
    })
    .catch(() => {});
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
