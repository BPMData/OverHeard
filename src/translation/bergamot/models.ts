// English → X models that OverHeard can run on this device: Bergamot (Firefox Translations)
// for most languages, and Opus-MT (via Transformers.js) for Swahili, which Bergamot lacks.
// They're the fallback when Chrome's built-in translator can't do a language: Safari, Firefox,
// managed or older Chromebooks, and languages Chrome lacks (Urdu, Dari, Swahili).
import { formatBytes } from '../../storage/registry';
import { BERGAMOT_MODELS } from './catalog';

/** Bergamot's file roles. Opus-MT files are all 'file': Transformers.js finds them by path. */
export type BergamotPart = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab' | 'file';

export interface BergamotFile {
  part: BergamotPart;
  /** Path under the model's base URL (BERGAMOT_BASE_URL unless the model sets `baseUrl`) */
  path: string;
  /** Exact decompressed size. GitHub Pages gzips in transit, so Content-Length can't be used. */
  bytes: number;
  sha256: string;
}

export interface BergamotModel {
  /** OverHeard language code */
  lang: string;
  /** Bergamot pair, e.g. 'enur' (Dari uses the Persian model, 'enfa'); for Opus-MT the model name */
  pair: string;
  /** Which runtime runs it. Default 'bergamot'. */
  engine?: 'bergamot' | 'opus';
  /** Host folder for `files`. Default BERGAMOT_BASE_URL. */
  baseUrl?: string;
  files: readonly BergamotFile[];
}

export { BERGAMOT_MODELS };

/**
 * Where Opus-MT models are served from: their own GitHub Pages site (each Pages site has a
 * 1 GB limit, and overheard-voices is near it), same bpmdata.github.io domain and CORS *.
 * VITE_OPUS_BASE_URL overrides it at build time.
 */
export const OPUS_BASE_URL: string =
  (import.meta.env?.VITE_OPUS_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://bpmdata.github.io/overheard-translation-models';

/**
 * Helsinki-NLP Opus-MT models (Apache-2.0), converted to int8 ONNX for Transformers.js.
 * See the README in BPMData/overheard-translation-models and docs/offline-translation-spike/.
 */
export const OPUS_MODELS: readonly BergamotModel[] = [
  {
    lang: 'sw',
    pair: 'opus-mt-en-sw',
    engine: 'opus',
    baseUrl: OPUS_BASE_URL,
    files: [
      {
        part: 'file',
        path: 'opus-mt-en-sw/config.json',
        bytes: 1365,
        sha256: '8523ef0c192068ea73f806d0f02a882b4ad868e66c285013391e7fa70f1db2e3',
      },
      {
        part: 'file',
        path: 'opus-mt-en-sw/generation_config.json',
        bytes: 288,
        sha256: 'a21d5f0c9d4ec8ee559c770696aeb31f730ad4aca7557b9b8687fa6c765689dd',
      },
      {
        part: 'file',
        path: 'opus-mt-en-sw/tokenizer.json',
        bytes: 1783587,
        sha256: '07ac46e1425c90316386d89cf7b64a821374c91f360379de4ec630afe1f04e7b',
      },
      {
        part: 'file',
        path: 'opus-mt-en-sw/tokenizer_config.json',
        bytes: 817,
        sha256: '032be71480f779ffc3d55e563be61c89bed31fd91017025b1099434454fd75bb',
      },
      {
        part: 'file',
        path: 'opus-mt-en-sw/onnx/encoder_model_quantized.onnx',
        bytes: 49688667,
        sha256: 'dc2dd1db0c59ee07026b1db5b5b7236ef5f44b8852eb18ef8eb00f972d18ec6a',
      },
      {
        part: 'file',
        path: 'opus-mt-en-sw/onnx/decoder_model_merged_quantized.onnx',
        bytes: 86947433,
        sha256: '24c57989d3dcf3fe62af2aea89f764d936bb8cb26b8835bfafd78e30a7f50def',
      },
    ],
  },
];

/** Every on-device model, both engines */
export const ON_DEVICE_MODELS: readonly BergamotModel[] = [...BERGAMOT_MODELS, ...OPUS_MODELS];

/** Full URL of one of a model's files; also its key in the saved-model cache. */
export const modelFileUrl = (model: BergamotModel, file: BergamotFile): string =>
  `${model.baseUrl ?? BERGAMOT_BASE_URL}/${file.path}`;

/**
 * Where the models are served from: the same GitHub Pages site as the MMS voices (CORS *,
 * allowed on school Wi-Fi). VITE_BERGAMOT_BASE_URL overrides it at build time.
 */
export const BERGAMOT_BASE_URL: string =
  (import.meta.env?.VITE_BERGAMOT_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://bpmdata.github.io/overheard-voices/bergamot';

/** Attribution for the models and the runtime (both MPL-2.0). */
export const BERGAMOT_ATTRIBUTION = {
  text: 'On-device translation by Firefox Translations (Bergamot), Mozilla, MPL-2.0',
  licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
  sourceUrl: 'https://github.com/mozilla/translations',
};

/** Attribution for the Swahili model (Apache-2.0). */
export const OPUS_ATTRIBUTION = {
  text: 'Swahili by Opus-MT (Helsinki-NLP), Apache-2.0',
  licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  sourceUrl: 'https://huggingface.co/Helsinki-NLP/opus-mt-en-sw',
};

/** Room for a translation, without letting a model that starts repeating itself run for seconds. */
export function maxNewTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(256, words * 4 + 16);
}

const byLang = new Map(ON_DEVICE_MODELS.map((model) => [model.lang, model]));

/** The model for English → `lang`, or null when Bergamot has none. */
export function bergamotModelFor(lang: string, source = 'en'): BergamotModel | null {
  if (source !== 'en') return null;
  return byLang.get(lang) ?? null;
}

export const modelBytes = (model: BergamotModel): number => model.files.reduce((sum, file) => sum + file.bytes, 0);

/** "35 MB" for the download button and Settings. */
export function bergamotDownloadLabel(lang: string): string {
  const model = bergamotModelFor(lang);
  return model ? formatBytes(modelBytes(model)) : '';
}

/**
 * Languages whose Bergamot model is a close relative rather than the language itself.
 * Dari uses the Persian model, which writes Iranian Persian: Afghan readers understand it,
 * but some everyday words and the register differ.
 */
export const BERGAMOT_APPROXIMATE: Readonly<Record<string, string>> = {
  prs: 'approximate: Iranian Persian, not Afghan Dari',
};
