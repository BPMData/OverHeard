import type { CaptionSegment, LanguageCode } from '../types';
import { LANGUAGE_MAP } from '../constants';
import { CaptionSwatch, CaptionText, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import { PictureInPicture2 } from 'lucide-react';

interface SubtitleBarProps {
  selectedLangs: LanguageCode[];
  subtitleLang: LanguageCode;
  isListening: boolean;
  isDark: boolean;
  hasPipApi: boolean;
  showPreviousLine: boolean;
  fontSize: number;
  currentSegment: CaptionSegment | null;
  previousSegment: CaptionSegment | null;
  segments: CaptionSegment[];
  liveTranslations: Partial<Record<string, string>>;
  pipWindow: Window | null;
  interimTranscript: string;
  setSubtitleLang: (lang: LanguageCode) => void;
  handleTogglePip: () => Promise<void>;
}

export function SubtitleBar({
  selectedLangs, subtitleLang, isListening, isDark, hasPipApi, showPreviousLine, fontSize,
  currentSegment, previousSegment, segments, liveTranslations, pipWindow, interimTranscript,
  setSubtitleLang, handleTogglePip,
}: SubtitleBarProps) {
  const previousFontSize = Math.max(16, Math.round(fontSize * 0.68));
  const activeSubtitleLang = selectedLangs.includes(subtitleLang)
    ? subtitleLang
    : selectedLangs[0];
  const subtitleCaptionColor = languageCaptionColor(
    Math.max(0, selectedLangs.indexOf(activeSubtitleLang))
  );

  return (
    <main className="flex-1 flex flex-col justify-between p-4 lg:p-8 pb-56">
      <div className="max-w-4xl mx-auto w-full rounded-[3px] border border-[#CBD5E1] dark:border-[#243044] bg-white dark:bg-[#111827] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0F172A] dark:text-[#F8FAFC]">
              Subtitle Bar Mode Active
            </h2>
            <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8]">
              The compact two-line caption bar is pinned to the bottom of the screen so you can position slides above it or pop it out into a floating window.
            </p>
          </div>
          {hasPipApi ? (
            <button
              type="button"
              onClick={handleTogglePip}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[2px] border text-xs font-bold whitespace-nowrap transition-colors ${
                pipWindow
                  ? 'border-emerald-600 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'oh-btn border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#A16207] dark:text-[#FACC15] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B]'
              }`}
            >
              <PictureInPicture2 className="w-4 h-4" />
              <span>
                {pipWindow ? 'Close Floating Window' : 'Pop out captions over slides'}
              </span>
            </button>
          ) : (
            <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">
              Tip: Resize or tile this window beneath your presentation slides.
            </span>
          )}
        </div>

        {segments.length > 0 && (
          <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#1E293B] max-h-60 overflow-y-auto space-y-2">
            <div className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
              Recent Transcript ({segments.length} phrases)
            </div>
            {segments.slice(-5).map((seg) => (
              <div
                key={seg.id}
                className="text-xs flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-1 border-b border-slate-200/50 dark:border-slate-800/60 last:border-0"
              >
                <span className="font-mono text-[#64748B] dark:text-[#94A3B8] shrink-0">
                  [{seg.timestamp}]
                </span>
                <span className="font-medium text-[#0F172A] dark:text-[#F8FAFC]">
                  {seg.english}
                </span>
                <span
                  dir={LANGUAGE_MAP[activeSubtitleLang].dir}
                  lang={activeSubtitleLang}
                  className="text-[#5843A5] dark:text-[#C4B5FD]"
                >
                  → {seg.translations[activeSubtitleLang] || '…'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixed Bottom Subtitle Bar */}
      <section
        aria-label="Bottom Subtitle Bar"
        className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-[#5843A5] dark:border-[#A78BFA] bg-white dark:bg-[#111827] px-6 py-4"
      >
        <div className="max-w-7xl mx-auto flex flex-col gap-2.5">
          {/* Top Row: English Caption + Language Switcher Pill */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {showPreviousLine && previousSegment && (
                <p
                  style={{ fontSize: `${Math.max(15, Math.round(previousFontSize * 0.85))}px` }}
                  className="text-[#64748B] dark:text-[#94A3B8] truncate mb-0.5"
                >
                  {previousSegment.english}
                </p>
              )}
              <p
                style={{ fontSize: `${Math.max(20, Math.round(fontSize * 0.82))}px` }}
                className={`font-semibold caption-text-ltr ${
                  interimTranscript.trim().length > 0 ? 'italic opacity-70' : ''
                }`}
              >
                {interimTranscript.trim().length > 0 || currentSegment ? (
                  <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                    {interimTranscript.trim().length > 0
                      ? interimTranscript
                      : currentSegment?.english}
                  </CaptionText>
                ) : (
                  <span className="text-[#64748B] dark:text-[#94A3B8]">
                    {isListening
                      ? 'Listening for teacher speech…'
                      : 'Press Start Listening (or Spacebar) to show live subtitles.'}
                  </span>
                )}
              </p>
            </div>

            {/* Target Language Switcher when >1 language is checked */}
            {selectedLangs.length > 1 && (
              <div className="flex items-center gap-1 p-1 rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#EAEFF6] dark:bg-[#090D16] shrink-0">
                {selectedLangs.map((code, langIndex) => {
                  const cfg = LANGUAGE_MAP[code];
                  const active = code === activeSubtitleLang;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setSubtitleLang(code)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-bold transition-colors whitespace-nowrap ${
                        active
                          ? 'oh-btn-primary border border-[#443180] bg-[#5843A5] dark:bg-[#6D56C6] text-white'
                          : 'text-[#475569] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
                      }`}
                    >
                      <CaptionSwatch color={languageCaptionColor(langIndex)} />
                      {cfg.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Row: Chosen Target Language Translation */}
          <div
            dir={LANGUAGE_MAP[activeSubtitleLang].dir}
            lang={activeSubtitleLang}
            className="border-t border-[#E2E8F0] dark:border-[#1E293B] pt-2"
          >
            {interimTranscript.trim().length > 0 &&
            liveTranslations[activeSubtitleLang] ? (
              <p
                style={{ fontSize: `${fontSize}px` }}
                className={`font-bold italic opacity-70 ${
                  LANGUAGE_MAP[activeSubtitleLang].dir === 'rtl'
                    ? 'caption-text-rtl'
                    : 'caption-text-ltr'
                }`}
              >
                <CaptionText color={subtitleCaptionColor} isDark={isDark}>
                  {liveTranslations[activeSubtitleLang]}
                </CaptionText>
              </p>
            ) : currentSegment ? (
              currentSegment.status === 'translating' &&
              !currentSegment.translations[activeSubtitleLang] ? (
                <p
                  style={{ fontSize: `${fontSize}px` }}
                  className="font-semibold text-[#64748B] dark:text-[#94A3B8] animate-pulse"
                >
                  Translating…
                </p>
              ) : currentSegment.translations[activeSubtitleLang] ===
                'translation unavailable' ? (
                <p
                  dir="ltr"
                  className="text-base font-medium text-amber-600 dark:text-amber-400 italic"
                >
                  translation unavailable
                </p>
              ) : (
                <p
                  style={{ fontSize: `${fontSize}px` }}
                  className={`font-bold ${
                    LANGUAGE_MAP[activeSubtitleLang].dir === 'rtl'
                      ? 'caption-text-rtl'
                      : 'caption-text-ltr'
                  }`}
                >
                  <CaptionText color={subtitleCaptionColor} isDark={isDark}>
                    {currentSegment.translations[activeSubtitleLang]}
                  </CaptionText>
                </p>
              )
            ) : (
              <p
                dir="ltr"
                className="text-sm text-[#64748B] dark:text-[#94A3B8]"
              >
                {LANGUAGE_MAP[activeSubtitleLang].name} subtitle line
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
