export type LanguageCode =
  | 'es'
  | 'pt'
  | 'ar'
  | 'zh'
  | 'vi'
  | 'ht'
  | 'fr'
  | 'uk'
  | 'ru'
  | 'so'
  | 'prs'
  | 'ps';

export interface LanguageConfig {
  code: LanguageCode;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
}

export type TranslationStatus = 'translating' | 'done' | 'error';

export interface CaptionSegment {
  id: number;
  timestamp: string;
  english: string;
  translations: Record<string, string>;
  status: TranslationStatus;
}

export type DisplayMode = 'columns' | 'subtitle';

/** A line shown in the pop-out caption window: English or one of the selected languages. */
export type PipLine = 'en' | LanguageCode;
