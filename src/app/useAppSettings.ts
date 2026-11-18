import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MAX_LANGUAGES, MIN_FONT_SIZE } from '../constants';
import type { DisplayMode, LanguageCode } from '../types';
import { parseInitialLanguages } from './settings';

export function useAppSettings() {
  // Language selection state hydrated from ?langs=
  const [selectedLangs, setSelectedLangs] = useState<LanguageCode[]>(() =>
    parseInitialLanguages()
  );
  const [subtitleLang, setSubtitleLang] = useState<LanguageCode>(
    () => parseInitialLanguages()[0] || 'es'
  );

  // Display & typography controls
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [showPreviousLine, setShowPreviousLine] = useState<boolean>(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('columns');
  const selectedLangsRef = useRef<LanguageCode[]>(selectedLangs);

  useEffect(() => {
    selectedLangsRef.current = selectedLangs;
    if (!selectedLangs.includes(subtitleLang) && selectedLangs.length > 0) {
      setSubtitleLang(selectedLangs[0]);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('langs', selectedLangs.join(','));
    window.history.replaceState({}, '', url.toString());
  }, [selectedLangs, subtitleLang]);

  // Toggle a target language (minimum 1, maximum 3)
  const handleToggleLanguage = (code: LanguageCode) => {
    setSelectedLangs((prev) => {
      if (prev.includes(code)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== code);
      }
      if (prev.length >= MAX_LANGUAGES) return prev;
      return [...prev, code];
    });
  };

  // Font size adjustment (20px to 56px)
  const handleAdjustFont = (delta: number) => {
    setFontSize((prev) =>
      Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, prev + delta))
    );
  };

  return {
    selectedLangs, setSelectedLangs, selectedLangsRef, subtitleLang, setSubtitleLang,
    fontSize, handleAdjustFont, handleToggleLanguage, displayMode, setDisplayMode,
    showPreviousLine, setShowPreviousLine,
  };
}
