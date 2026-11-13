import React from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Minus, Plus, X } from 'lucide-react';
import { LANGUAGE_MAP, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../constants';
import { CaptionSegment, LanguageCode } from '../types';

interface PipSubtitlePortalProps {
  pipWindow: Window | null;
  onClosePip: () => void;
  isDark: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  fontSize: number;
  onAdjustFont: (delta: number) => void;
  selectedLangs: LanguageCode[];
  subtitleLang: LanguageCode;
  onSelectSubtitleLang: (code: LanguageCode) => void;
  currentSegment: CaptionSegment | null;
  interimTranscript: string;
  liveTranslation?: string;
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
  subtitleLang,
  onSelectSubtitleLang,
  currentSegment,
  interimTranscript,
  liveTranslation,
}) => {
  if (!pipWindow) return null;

  const activeLangCode = selectedLangs.includes(subtitleLang)
    ? subtitleLang
    : selectedLangs[0];
  const langConfig = LANGUAGE_MAP[activeLangCode];

  const englishLine =
    interimTranscript.trim().length > 0
      ? interimTranscript
      : currentSegment?.english || '';

  const isSpeaking = interimTranscript.trim().length > 0;
  const translationLine = isSpeaking && liveTranslation
    ? liveTranslation
    : currentSegment
    ? currentSegment.translations[activeLangCode] ||
      (currentSegment.status === 'translating' ? 'Translating…' : '')
    : '';

  const pipFontSize = Math.max(20, Math.min(44, Math.round(fontSize * 0.85)));

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

        {/* Language Switcher if >1 active language */}
        <div className="flex items-center gap-1.5">
          {selectedLangs.map((code) => {
            const cfg = LANGUAGE_MAP[code];
            const active = code === activeLangCode;
            return (
              <button
                key={code}
                type="button"
                onClick={() => onSelectSubtitleLang(code)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950'
                    : 'hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {cfg.name}
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

      {/* Two-Line Live Subtitle Display */}
      <div className="flex-1 flex flex-col justify-center px-5 py-3 gap-2 overflow-y-auto">
        <div
          style={{ fontSize: `${Math.round(pipFontSize * 0.82)}px` }}
          className={`font-medium leading-snug ${
            interimTranscript.trim().length > 0
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

        <div
          dir={langConfig.dir}
          style={{ fontSize: `${pipFontSize}px` }}
          className={`font-bold ${
            langConfig.dir === 'rtl' ? 'caption-text-rtl' : 'caption-text-ltr'
          } ${
            translationLine === 'translation unavailable'
              ? 'text-amber-500 text-base font-normal italic'
              : 'text-[#0284C7] dark:text-[#38BDF8]'
          }`}
        >
          {translationLine || (
            <span className="text-slate-400 dark:text-slate-600 text-sm font-normal">
              {langConfig.name} translation appears here as sentences complete
            </span>
          )}
        </div>
      </div>
    </div>,
    pipWindow.document.body
  );
};
