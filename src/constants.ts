import { LanguageCode, LanguageConfig } from './types';

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'zh', name: 'Simplified Chinese', nativeName: '简体中文', dir: 'ltr' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr' },
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl Ayisyen', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali', dir: 'ltr' },
  { code: 'prs', name: 'Dari', nativeName: 'دری', dir: 'rtl' },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', dir: 'rtl' },
];

export const LANGUAGE_MAP: Record<LanguageCode, LanguageConfig> = SUPPORTED_LANGUAGES.reduce(
  (acc, lang) => {
    acc[lang.code] = lang;
    return acc;
  },
  {} as Record<LanguageCode, LanguageConfig>
);

export const VALID_LANGUAGE_CODES = new Set<string>(
  SUPPORTED_LANGUAGES.map((l) => l.code)
);

export const DEFAULT_LANGUAGES: LanguageCode[] = ['es', 'pt'];
export const MAX_LANGUAGES = 3;
export const DEFAULT_FONT_SIZE = 32;
export const MIN_FONT_SIZE = 20;
export const MAX_FONT_SIZE = 56;
export const FONT_STEP = 4;

export interface SampleSentence {
  subject: string;
  text: string;
}

export const SAMPLE_SENTENCES: SampleSentence[] = [
  {
    subject: 'Science',
    text: 'Photosynthesis converts sunlight, water, and carbon dioxide into glucose and oxygen.',
  },
  {
    subject: 'Math',
    text: 'To find the area of a right triangle, multiply the base by the height and divide by two.',
  },
  {
    subject: 'History',
    text: 'According to legend, the Zaporozhian Cossacks answered an ultimatum from Ottoman Sultan Mehmed IV with an insulting letter, a scene Ilya Repin painted between 1880 and 1891.',
  },
  {
    subject: 'Classroom',
    text: 'Please open your lab notebooks to page fourteen and discuss the first hypothesis with your partner.',
  },
];
