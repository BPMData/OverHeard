// Bergamot (Firefox Translations) English → X models that OverHeard can run on this device.
// They're the fallback when Chrome's built-in translator can't do a language: Safari, Firefox,
// managed or older Chromebooks, and languages Chrome lacks (Urdu, Dari).
import { formatBytes } from '../../storage/registry';
import { BERGAMOT_MODELS } from './catalog';

export type BergamotPart = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab';

export interface BergamotFile {
  part: BergamotPart;
  /** Path under BERGAMOT_BASE_URL */
  path: string;
  /** Exact decompressed size. GitHub Pages gzips in transit, so Content-Length can't be used. */
  bytes: number;
  sha256: string;
}

export interface BergamotModel {
  /** OverHeard language code */
  lang: string;
  /** Bergamot pair, e.g. 'enur'. Dari uses the Persian model ('enfa'). */
  pair: string;
  files: readonly BergamotFile[];
}

export { BERGAMOT_MODELS };

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

const byLang = new Map(BERGAMOT_MODELS.map((model) => [model.lang, model]));

/** The model for English → `lang`, or null when Bergamot has none. */
export function bergamotModelFor(lang: string, source = 'en'): BergamotModel | null {
  if (source !== 'en') return null;
  return byLang.get(lang) ?? null;
}

export const modelBytes = (model: BergamotModel): number =>
  model.files.reduce((sum, file) => sum + file.bytes, 0);

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
