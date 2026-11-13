// On-device mode: Chrome's built-in Translator API and on-device speech recognition.
// Nothing here talks to a server. Callers fall back to the cloud path when something
// isn't available (unsupported browser, unsupported language, blocked by policy).

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

/**
 * Get (and, if needed, download) the on-device translator for English → `code`.
 * Resolves to null when the language isn't supported on this device.
 * The first call that triggers a download must come from a click or key press.
 */
export function getOnDeviceTranslator(code: string): Promise<TranslatorInstance | null> {
  const existing = translators.get(code);
  if (existing) return existing;

  const api = getTranslatorApi();
  const promise: Promise<TranslatorInstance | null> = (async () => {
    if (!api) return null;
    const langs = { sourceLanguage: 'en', targetLanguage: toTranslatorCode(code) };
    const availability = await api.availability(langs);
    if (availability === 'unavailable') return null;
    return api.create(langs);
  })();

  translators.set(code, promise);
  // Don't cache failures (e.g. a download that needed a user gesture); try again next time
  promise.catch(() => translators.delete(code));
  return promise;
}

/** Start downloading language packs for these languages. Call from a click handler. */
export function prepareOnDeviceTranslators(codes: string[]): void {
  for (const code of codes) {
    getOnDeviceTranslator(code).catch(() => {
      // Reported when a caption actually needs it
    });
  }
}

export class OnDeviceUnavailableError extends Error {}

export async function translateOnDevice(text: string, code: string): Promise<string> {
  const translator = await getOnDeviceTranslator(code);
  if (!translator) {
    throw new OnDeviceUnavailableError(`No on-device translator for ${code}`);
  }
  return translator.translate(text);
}

/**
 * Make sure on-device English speech recognition is ready, downloading it if needed.
 * Returns true if recognition can run locally. Call from a click handler (install needs one).
 */
export async function prepareOnDeviceSpeech(lang = 'en-US'): Promise<boolean> {
  const api = getSpeechApi();
  if (!api) return false;
  try {
    if (api.available && api.install) {
      const opts = { langs: [lang], processLocally: true };
      const status = await api.available(opts);
      if (status === 'available') return true;
      if (status === 'unavailable') return false;
      return await api.install(opts);
    }
    if (api.availableOnDevice && api.installOnDevice) {
      const status = await api.availableOnDevice(lang);
      if (status === 'available') return true;
      if (status === 'unavailable') return false;
      return await api.installOnDevice(lang);
    }
  } catch {
    // Treat any error (policy block, missing gesture, ChromeOS) as "not available"
  }
  return false;
}
