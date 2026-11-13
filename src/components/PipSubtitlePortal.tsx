import React from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Minus, Plus, X } from 'lucide-react';
import { LANGUAGE_MAP, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../constants';
import { CaptionSegment, LanguageCode, PipLine } from '../types';

/** Most caption lines the pop-out shows at once (e.g. English + 2 languages). */
export const MAX_PIP_LINES = 3;

/** Pop-out window height that fits `lineCount` caption lines plus the toolbar. */
export const pipHeightFor = (lineCount: number): number => 110 + lineCount * 70;

interface PipSubtitlePortalProps {
  pipWindow: Window | null;
  onClosePip: () => void;
  isDark: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  fontSize: number;
  onAdjustFont: (delta: number) => void;
  selectedLangs: LanguageCode[];
  /** Lines currently shown, in display order. */
  visibleLines: PipLine[];
  onToggleLine: (line: PipLine) => void;
  currentSegment: CaptionSegment | null;
  interimTranscript: string;
  liveTranslations: Record<string, string>;
}

export const PipSubtitlePortal: React.FC<PipSubtitlePortalProps> = ({
  pipWindow,
  onClosePip,
  isDark,
  isListening,
  onToggleListening,
  fontSize,
  onAdjustFont,
  selectedLangs,
  visibleLines,
  onToggleLine,
  currentSegment,
  interimTranscript,
  liveTranslations,
}) => {
  if (!pipWindow) return null;

  const isSpeaking = interimTranscript.trim().length > 0;
  const englishLine = isSpeaking
    ? interimTranscript
    : currentSegment?.english || '';

  const translationFor = (code: LanguageCode): string => {
    if (isSpeaking && liveTranslations[code]) return liveTranslations[code];
    if (!currentSegment) return '';
    return (
      currentSegment.translations[code] ||
      (currentSegment.status === 'translating' ? 'Translating…' : '')
    );
  };

  // Shrink text a little when three lines share the window
  const baseFontSize = Math.max(20, Math.min(44, Math.round(fontSize * 0.85)));
  const pipFontSize =
    visibleLines.length >= 3 ? Math.round(baseFontSize * 0.8) : baseFontSize;
  const translationCount = visibleLines.filter((l) => l !== 'en').length;
  const atMax = visibleLines.length >= MAX_PIP_LINES;

  const chipOptions: PipLine[] = ['en', ...selectedLangs];

  return createPortal(
    <div
      className={`h-screen w-screen flex flex-col justify-between select-none overflow-hidden ${
        isDark
          ? 'bg-[#090D16] text-[#F8FAFC]'
          : 'bg-[#F8FAFC] text-[#0F172A]'
      }`}
    >
      {/* Compact Floating Toolbar */}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2 border-b text-xs ${
          isDark
            ? 'bg-[#111827] border-[#1E293B] text-[#94A3B8]'
            : 'bg-white border-[#E2E8F0] text-[#64748B]'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-bold tracking-tight text-slate-900 dark:text-white">
            OverHeard
          </span>
          <button
            type="button"
            onClick={onToggleListening}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold text-xs transition-colors ${
              isListening
                ? 'bg-emerald-600 text-white'
                : 'bg-sky-500 text-slate-950'
            }`}
          >
            {isListening ? (
              <>
                <Mic className="w-3.5 h-3.5 animate-pulse" />
                <span>Listening</span>
              </>
            ) : (
              <>
                <MicOff className="w-3.5 h-3.5" />
                <span>Start Mic</span>
              </>
            )}
          </button>
        </div>

        {/* Line toggles: pick which lines (English and/or languages) to show, up to MAX_PIP_LINES */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Lines to show">
          {chipOptions.map((line) => {
            const shown = visibleLines.includes(line);
            const label = line === 'en' ? 'English' : LANGUAGE_MAP[line].name;
            const disabled =
              (!shown && atMax) || (shown && visibleLines.length === 1);
            return (
              <button
                key={line}
                type="button"
                aria-pressed={shown}
                disabled={disabled}
                onClick={() => onToggleLine(line)}
                title={
                  !shown && atMax
                    ? `Up to ${MAX_PIP_LINES} lines — hide one first`
                    : shown
                      ? `Hide ${label}`
                      : `Show ${label}`
                }
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                  shown
                    ? 'bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950'
                    : 'hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAdjustFont(-4)}
            disabled={fontSize <= MIN_FONT_SIZE}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Decrease font size"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onAdjustFont(4)}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Increase font size"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClosePip}
            className="p-1 ml-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800"
            title="Return to main window"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Caption lines */}
      <div className="flex-1 flex flex-col justify-center px-5 py-3 gap-2 overflow-y-auto">
        {visibleLines.map((line) => {
          if (line === 'en') {
            return (
              <div
                key="en"
                style={{ fontSize: `${Math.round(pipFontSize * 0.82)}px` }}
                className={`font-medium leading-snug ${
                  isSpeaking
                    ? 'text-slate-500 dark:text-[#94A3B8] italic'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {englishLine || (
                  <span className="text-slate-400 dark:text-slate-600 text-base">
                    {isListening
                      ? 'Listening for teacher speech…'
                      : 'Press Start Mic to caption over your slides.'}
                  </span>
                )}
              </div>
            );
          }

          const cfg = LANGUAGE_MAP[line];
          const text = translationFor(line);
          const isLive = isSpeaking && Boolean(liveTranslations[line]);
          return (
            <div
              key={line}
              dir={cfg.dir}
              className="flex items-baseline gap-2.5"
            >
              {/* Language tag only when several translations share the window */}
              {translationCount > 1 && (
                <span
                  dir="ltr"
                  className="shrink-0 text-[11px] font-mono font-semibold uppercase text-slate-400 dark:text-slate-500"
                >
                  {line}
                </span>
              )}
              <div
                style={{ fontSize: `${pipFontSize}px` }}
                className={`font-bold leading-snug ${
                  cfg.dir === 'rtl' ? 'caption-text-rtl' : 'caption-text-ltr'
                } ${
                  text === 'translation unavailable'
                    ? 'text-amber-500 text-base font-normal italic'
                    : isLive
                      ? 'text-[#0284C7]/80 dark:text-[#38BDF8]/80 italic'
                      : 'text-[#0284C7] dark:text-[#38BDF8]'
                }`}
              >
                {text || (
                  <span className="text-slate-400 dark:text-slate-600 text-sm font-normal">
                    {cfg.name} translation appears here as sentences complete
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    pipWindow.document.body
  );
};
