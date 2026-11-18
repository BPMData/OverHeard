import { useEffect } from 'react';
import type { DisplayMode } from '../types';

export function useCaptionHotkey(displayMode: DisplayMode, toggleListening: () => void) {
  // Spacebar toggles Start/Stop unless focus is inside <input>, <textarea>, or <select>
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (displayMode === 'conversation' || e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      toggleListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayMode, toggleListening]);
}
