import React from 'react';
import {
  CaptionText,
  ENGLISH_CAPTION_COLOR,
  languageCaptionColor,
} from '../captionColors';
import { createPortal } from 'react-dom';
import { Columns2, Mic, MicOff, Minus, Plus, X } from 'lucide-react';
import { WhiteboatIcon } from './WhiteboatIcon';
import { LANGUAGE_MAP, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../constants';
import { CaptionSegment, LanguageCode, PipLayout, PipLine } from '../types';

/** Most caption lines the pop-out shows at once (e.g. English + 2 languages). */
export const MAX_PIP_LINES = 3;

/**
 * Default pop-out height for a fresh window: a compact subtitle strip.
 * The toolbar overlays the captions on hover, so it takes no space of its own.
 * Users can drag the window to any shape; we never force a size afterwards.
 */
export const pipHeightFor = (lineCount: number): number => 24 + lineCount * 68;

interface PipSubtitlePortalProps {
  pipWindow: Window | null;
  onClosePip: () => void;
  isDark: boolean;
  isListening: boolean;
  onToggleListening?: () => void;
  fontSize: number;
  onAdjustFont: (delta: number) => void;
  selectedLangs: LanguageCode[];
  /** Lines currently shown, in display order. */
  visibleLines: PipLine[];
  onToggleLine: (line: PipLine) => void;
  layout?: PipLayout;
  onToggleLayout?: () => void;
  currentSegment: CaptionSegment | null;
  interimTranscript: string;
  liveTranslations: Partial<Record<string, string>>;
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
  layout = 'stacked',
  onToggleLayout,
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
    if (isSpeaking) return liveTranslations[code] || 'Translating…';
    if (!currentSegment) return '';
    return (
      currentSegment.translations[code] ||
      (currentSegment.status === 'translating' ? 'Translating…' : '')
    );
  };

  const isSideBySide = layout === 'columns' && visibleLines.length > 1;
  // Shrink text a little when three lines share height or columns share width
  const baseFontSize = Math.max(20, Math.min(44, Math.round(fontSize * 0.85)));
  const pipFontSize =
    visibleLines.length >= 3 ? Math.round(baseFontSize * (isSideBySide ? 0.72 : 0.8)) : baseFontSize;
  const translationCount = visibleLines.filter((l) => l !== 'en').length;
  const atMax = visibleLines.length >= MAX_PIP_LINES;

  const chipOptions: PipLine[] = ['en', ...selectedLangs];

  return createPortal(
    <div
      className={`group relative h-screen w-screen flex flex-col select-none overflow-hidden ${
        isDark
          ? 'bg-[#090D16] text-[#F8FAFC]'
          : 'bg-[#F8FAFC] text-[#0F172A]'
      }`}
    >
      {/* Floating toolbar: hidden until the pointer is over the window (or a control has keyboard focus),
          so the captions get the whole window. Wraps instead of overflowing in narrow/tall windows. */}
      <div
        className={`oh-chrome-bar absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 border-b text-xs transition-opacity duration-150 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto ${
          isDark
            ? 'bg-[#111827] border-[#243044] text-[#94A3B8]'
            : 'bg-white border-[#CBD5E1] text-[#64748B]'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-tight text-slate-900 dark:text-white">
            <WhiteboatIcon app="overheard" size={18} />
            <span>OverHeard</span>
          </span>
          {onToggleListening && <button
            type="button"
            onClick={onToggleListening}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] border font-semibold text-xs transition-colors ${
              isListening
                ? 'oh-btn-listening border-[#047857] bg-emerald-600 text-white'
                : 'oh-btn-primary border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white'
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
          </button>}
        </div>

        {/* Line toggles: pick which lines (English and/or languages) to show, up to MAX_PIP_LINES */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lines to show">
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
                className={`px-2 py-0.5 rounded-[2px] text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                  shown
                    ? 'oh-btn-primary bg-[#5843A5] dark:bg-[#6D56C6] text-white'
                    : 'hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          {onToggleLayout && visibleLines.length > 1 && (
            <button
              type="button"
              onClick={onToggleLayout}
              aria-pressed={layout === 'columns'}
              aria-label={
                layout === 'columns'
                  ? 'Side by side columns (switch to stacked)'
                  : 'Side by side columns'
              }
              title={
                layout === 'columns'
                  ? 'Stack caption lines vertically'
                  : 'Arrange caption lines side by side'
              }
              className={`inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded-[2px] text-xs font-semibold transition-colors whitespace-nowrap ${
                layout === 'columns'
                  ? 'oh-btn-primary bg-[#5843A5] dark:bg-[#6D56C6] text-white'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Side by side</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onAdjustFont(-4)}
            disabled={fontSize <= MIN_FONT_SIZE}
            className="p-1 rounded-[2px] hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Decrease font size"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onAdjustFont(4)}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="p-1 rounded-[2px] hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Increase font size"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClosePip}
            className="p-1 ml-1 rounded-[2px] hover:bg-slate-200 dark:hover:bg-slate-800"
            title="Return to main window"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Caption lines fill the whole window at any shape (wide strip, side-by-side columns, or tall column).
          Each line gets an equal share, bottom-aligned like subtitles; if a sentence doesn't fit its share,
          the oldest words scroll off the top so the newest stay visible. */}
      <div
        data-layout={isSideBySide ? 'columns' : 'stacked'}
        style={
          isSideBySide
            ? { gridTemplateColumns: `repeat(${visibleLines.length}, minmax(0, 1fr))` }
            : undefined
        }
        className={`flex-1 min-h-0 px-4 py-2 ${
          isSideBySide ? 'grid gap-3 items-stretch' : 'flex flex-col gap-2'
        }`}
      >
        {visibleLines.map((line, index) => {
          const columnDivider =
            isSideBySide && index > 0
              ? 'border-l border-slate-200 dark:border-slate-800 pl-3'
              : '';
          if (line === 'en') {
            return (
              <div
                key="en"
                style={{ fontSize: `${Math.round(pipFontSize * 0.82)}px` }}
                className={`flex-1 min-h-0 min-w-0 flex flex-col justify-end overflow-hidden font-medium leading-snug ${columnDivider} ${
                  isSpeaking ? 'italic opacity-70' : ''
                }`}
              >
                <div>
                  {englishLine ? (
                    <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                      {englishLine}
                    </CaptionText>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-600 text-base">
                      {isListening
                        ? 'Listening for teacher speech…'
                        : onToggleListening ? 'Press Start Mic to caption over your slides. Hover for controls.'
                          : 'Waiting for lecture captions…'}
                    </span>
                  )}
                </div>
              </div>
            );
          }

          const cfg = LANGUAGE_MAP[line];
          const text = translationFor(line);
          const captionColor = languageCaptionColor(Math.max(0, selectedLangs.indexOf(line)));
          const isLive = isSpeaking && Boolean(liveTranslations[line]);
          return (
            <div
              key={line}
              dir={cfg.dir}
              lang={line}
              className={`flex-1 min-h-0 min-w-0 flex items-end gap-2.5 overflow-hidden ${columnDivider}`}
            >
              {/* Language tag only when several translations share the window */}
              {translationCount > 1 && (
                <span
                  dir="ltr"
                  className="shrink-0 pb-1 text-[11px] font-mono font-semibold uppercase text-slate-400 dark:text-slate-500"
                >
                  {line}
                </span>
              )}
              <div
                style={{ fontSize: `${pipFontSize}px` }}
                className={`min-w-0 max-h-full flex flex-col justify-end overflow-hidden font-bold leading-snug ${
                  cfg.dir === 'rtl' ? 'caption-text-rtl' : 'caption-text-ltr'
                } ${
                  text === 'translation unavailable'
                    ? 'text-amber-500 text-base font-normal italic'
                    : isLive
                      ? 'italic opacity-80'
                      : ''
                }`}
              >
                <div>
                  {text && text !== 'translation unavailable' && text !== 'Translating…' ? (
                    <CaptionText color={captionColor} isDark={isDark}>
                      {text}
                    </CaptionText>
                  ) : text ? (
                    text
                  ) : (
                    <span className="text-slate-400 dark:text-slate-600 text-sm font-normal">
                      {cfg.name} translation appears here as sentences complete
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    pipWindow.document.body
  );
};
