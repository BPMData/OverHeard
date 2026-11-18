import { useCallback, useEffect, useState } from 'react';
import { parseInitialLanguages, PIP_LINES_STORAGE_KEY, PIP_SIZE_STORAGE_KEY } from '../app/settings';
import { useTheme } from '../app/useTheme';
import { MAX_PIP_LINES, pipHeightFor } from '../components/PipSubtitlePortal';
import { togglePipLine, visiblePipLines as getVisiblePipLines } from '../pipLines';
import { LISTENING_PIP_LAYOUT_STORAGE_KEY, parsePipLayout } from '../rooms/studentPrefs';
import type { LanguageCode, PipLayout, PipLine } from '../types';

export function usePipWindow(selectedLangs: LanguageCode[], isEmbeddedIframe: boolean) {
  // Document Picture-in-Picture window state
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipNotice, setPipNotice] = useState<string | null>(null);

  // Which lines the pop-out shows (English and/or languages). Default: English + first 2 languages.
  const [pipLines, setPipLines] = useState<PipLine[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PIP_LINES_STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length > 0) return saved as PipLine[];
    } catch {
      // Storage unavailable or malformed; fall back to the default
    }
    return ['en', ...parseInitialLanguages().slice(0, MAX_PIP_LINES - 1)];
  });

  const [pipLayout, setPipLayout] = useState<PipLayout>(() => {
    try {
      return parsePipLayout(localStorage.getItem(LISTENING_PIP_LAYOUT_STORAGE_KEY));
    } catch {
      return 'stacked';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PIP_LINES_STORAGE_KEY, JSON.stringify(pipLines));
    } catch {
      // Ignore storage failures; the choice still applies for this session
    }
  }, [pipLines]);

  useEffect(() => {
    try {
      localStorage.setItem(LISTENING_PIP_LAYOUT_STORAGE_KEY, pipLayout);
    } catch {
      // Ignore storage failures
    }
  }, [pipLayout]);

  const { isDark, setIsDark } = useTheme(pipWindow);
  useEffect(() => {
    if (pipWindow && !pipWindow.closed) {
      if (isDark) {
        pipWindow.document.documentElement.classList.add('dark');
      } else {
        pipWindow.document.documentElement.classList.remove('dark');
      }
    }
  }, [isDark, pipWindow]);

  // Pop-out lines: keep only English + languages still selected, in on-screen order
  const visiblePipLines = getVisiblePipLines(pipLines, selectedLangs, MAX_PIP_LINES);

  const handleTogglePipLine = (line: PipLine) => {
    const next = togglePipLine(visiblePipLines, line, selectedLangs, MAX_PIP_LINES);
    if (!next) return;
    // Never resize the window here: the user may have shaped it (wide strip, tall column…)
    // and the caption lines already re-share whatever space it has.
    setPipLines(next);
  };

  // Document Picture-in-Picture Pop-Out Window
  const handleTogglePip = async () => {
    setPipNotice(null);

    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      setPipWindow(null);
      return;
    }

    if (!window.documentPictureInPicture) {
      setPipNotice(
        'Floating Picture-in-Picture requires desktop Chrome or Edge. Use Subtitle Mode or tile windows side-by-side.'
      );
      return;
    }

    try {
      // Reopen at the size the user last dragged it to (e.g. a tall strip down the side);
      // otherwise start as a compact subtitle strip.
      let savedSize: { width?: number; height?: number } | null = null;
      try {
        savedSize = JSON.parse(localStorage.getItem(PIP_SIZE_STORAGE_KEY) || 'null');
      } catch {
        savedSize = null;
      }
      const win = await window.documentPictureInPicture.requestWindow({
        width:
          savedSize?.width && savedSize.width >= 120 ? savedSize.width : 920,
        height:
          savedSize?.height && savedSize.height >= 60
            ? savedSize.height
            : pipHeightFor(visiblePipLines.length),
      });

      // Remember the shape whenever the user resizes it
      let sizeSaveTimer: number | undefined;
      win.addEventListener('resize', () => {
        window.clearTimeout(sizeSaveTimer);
        sizeSaveTimer = window.setTimeout(() => {
          try {
            localStorage.setItem(
              PIP_SIZE_STORAGE_KEY,
              JSON.stringify({ width: win.innerWidth, height: win.innerHeight })
            );
          } catch {
            // Ignore storage failures
          }
        }, 300);
      });

      // Copy stylesheets & Google Fonts from main document into the PiP window
      Array.from(document.styleSheets).forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            win.document.head.appendChild(link);
          } else if (styleSheet.cssRules) {
            const style = win.document.createElement('style');
            const cssText = Array.from(styleSheet.cssRules)
              .map((rule) => rule.cssText)
              .join('\n');
            style.textContent = cssText;
            win.document.head.appendChild(style);
          }
        } catch {
          // Cross-origin stylesheet fallback
          if (styleSheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            win.document.head.appendChild(link);
          }
        }
      });

      win.document.title = 'OverHeard — Live Captions';
      win.document.body.style.margin = '0';
      if (isDark) {
        win.document.documentElement.classList.add('dark');
      }

      win.addEventListener('pagehide', () => {
        setPipWindow(null);
      });

      setPipWindow(win);
    } catch {
      setPipNotice(
        isEmbeddedIframe
          ? 'Pop-out windows are blocked inside embedded preview frames. Click "Open Full Tab" in the top banner to pop out captions over slides.'
          : 'Could not open floating window. Try Subtitle Mode at the bottom of the screen.'
      );
    }
  };

  const closePip = () => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
    }
    setPipWindow(null);
  };

  const closePipForConversation = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
    setPipNotice(null);
  }, [pipWindow]);

  return {
    pipWindow, pipNotice, setPipNotice, visiblePipLines, pipLayout, setPipLayout, isDark, setIsDark,
    handleTogglePip, handleTogglePipLine, closePip, closePipForConversation,
  };
}
