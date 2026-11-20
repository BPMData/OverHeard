import type { CaptionSegment, LanguageCode } from '../types';
import type { useColumnPlayback } from '../captions/useColumnPlayback';
import { LANGUAGE_MAP } from '../constants';
import { CaptionSwatch, CaptionText, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import { History, Square, Volume2 } from 'lucide-react';

interface ColumnsViewProps {
  selectedLangs: LanguageCode[];
  isListening: boolean;
  isDark: boolean;
  showPreviousLine: boolean;
  fontSize: number;
  currentSegment: CaptionSegment | null;
  previousSegment: CaptionSegment | null;
  liveTranslations: Partial<Record<string, string>>;
  interimTranscript: string;
  columnPlayback: ReturnType<typeof useColumnPlayback>['columnPlayback'];
  speakColumnTranslation: (code: LanguageCode, text: string) => void;
  stopColumnPlayback: () => void;
}

export function ColumnsView({
  selectedLangs, isListening, isDark, showPreviousLine, fontSize, currentSegment,
  previousSegment, liveTranslations, interimTranscript, columnPlayback, speakColumnTranslation,
  stopColumnPlayback,
}: ColumnsViewProps) {
  const previousFontSize = Math.max(16, Math.round(fontSize * 0.68));
  const gridColsClass =
    selectedLangs.length === 1
      ? 'grid-cols-1 lg:grid-cols-2'
      : selectedLangs.length === 2
      ? 'grid-cols-1 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';

  return (
    <main className="flex-1 p-4 lg:p-6 flex flex-col">
      <div className={`flex-1 grid ${gridColsClass} gap-4 lg:gap-6 items-stretch`}>
        {/* Column 0: English Source Column */}
        <section
          aria-label="English Captions"
          className="flex flex-col rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-bold tracking-tight text-[#0F172A] dark:text-[#F8FAFC]">
                English
              </span>
              <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                en-US · Teacher
              </span>
            </div>
            {currentSegment && (
              <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                #{currentSegment.id} · {currentSegment.timestamp}
              </span>
            )}
          </div>

          <div className="flex-1 flex flex-col justify-between p-6 lg:p-8 gap-6">
            {/* Previous Line (0.68x font size, muted, above hairline divider) */}
            {showPreviousLine && (
              <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] pb-5 min-h-[4.5rem] flex flex-col justify-end">
                <div className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8] mb-1.5">
                  Previous line
                </div>
                {previousSegment ? (
                  <p
                    style={{ fontSize: `${previousFontSize}px` }}
                    className="font-medium text-[#64748B] dark:text-[#94A3B8] caption-text-ltr transition-all"
                  >
                    {previousSegment.english}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 dark:text-slate-600 italic">
                    No preceding sentence yet
                  </p>
                )}
              </div>
            )}

            {/* Current Line + Dimmed Live Interim Speech */}
            <div className="flex-1 flex flex-col justify-center space-y-4">
              {currentSegment ? (
                <p
                  style={{ fontSize: `${fontSize}px` }}
                  className="font-bold caption-text-ltr tracking-tight"
                >
                  <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                    {currentSegment.english}
                  </CaptionText>
                </p>
              ) : (
                !interimTranscript && (
                  <div className="space-y-2">
                    <p
                      style={{ fontSize: `${Math.max(22, Math.round(fontSize * 0.78))}px` }}
                      className="font-semibold text-[#64748B] dark:text-[#94A3B8]"
                    >
                      {isListening
                        ? 'Listening… speak naturally in English.'
                        : 'Press Start Listening (or Spacebar) to begin live classroom captions.'}
                    </p>
                    <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8]">
                      Want to test silently first? Click <strong>Test Input</strong> in the top bar to try sample Science, Math, or History sentences.
                    </p>
                  </div>
                )
              )}

              {/* Live Interim Speech (dimmed) */}
              {interimTranscript.trim().length > 0 && (
                <div className="pt-2">
                  <span className="inline-block text-xs font-mono text-[#5843A5] dark:text-[#C4B5FD] mb-1">
                    Speaking live…
                  </span>
                  <p
                    style={{ fontSize: `${fontSize}px` }}
                    className="font-semibold italic opacity-70 caption-text-ltr"
                  >
                    <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                      {interimTranscript}
                    </CaptionText>
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Target Language Columns (up to 3) */}
        {selectedLangs.map((code, langIndex) => {
          const lang = LANGUAGE_MAP[code];
          const isRtl = lang.dir === 'rtl';
          const captionColor = languageCaptionColor(langIndex);
          const prevText = previousSegment?.translations[code];
          const currText = currentSegment?.translations[code];
          const isTranslating =
            currentSegment?.status === 'translating' && !currText;
          const isUnavailable = currText === 'translation unavailable';
          const canPlay = Boolean(currText && !isTranslating && !isUnavailable);
          const isThisColActive = columnPlayback?.code === code;

          return (
            <section
              key={code}
              aria-label={`${lang.name} Translation`}
              className="flex flex-col rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] dark:border-[#1E293B]">
                <div className="flex items-center gap-2.5">
                  <CaptionSwatch color={captionColor} />
                  <span className="text-base font-bold tracking-tight text-[#0F172A] dark:text-[#F8FAFC]">
                    {lang.name}
                  </span>
                  <span
                    dir={lang.dir}
                    lang={lang.code}
                    className="text-xs text-[#64748B] dark:text-[#94A3B8]"
                  >
                    {lang.nativeName}
                    {isRtl ? ' · RTL' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canPlay && !isThisColActive}
                    onClick={() => {
                      if (isThisColActive) stopColumnPlayback();
                      else if (currText) speakColumnTranslation(code, currText);
                    }}
                    aria-label={
                      isThisColActive
                        ? `Stop reading ${lang.name} translation`
                        : `Read ${lang.name} translation aloud`
                    }
                    title={
                      isThisColActive
                        ? 'Stop reading'
                        : canPlay
                          ? `Read ${lang.name} translation aloud`
                          : 'Translation appears here after a sentence finishes'
                    }
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border transition-colors ${
                      isThisColActive
                        ? 'border-[#5843A5] bg-[#5843A5] text-white dark:border-[#A78BFA] dark:bg-[#5843A5]'
                        : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#475569] dark:text-[#CBD5E1] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isThisColActive ? (
                      <>
                        <Square className="w-3 h-3" />
                        <span>
                          {columnPlayback.status === 'downloading' ? 'Loading…' : 'Stop'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                  <span className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8]">
                    {code}
                  </span>
                </div>
              </div>

              <div
                dir={lang.dir}
                lang={lang.code}
                className="flex-1 flex flex-col justify-between p-6 lg:p-8 gap-6"
              >
                {/* Previous Translated Line */}
                {showPreviousLine && (
                  <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] pb-5 min-h-[4.5rem] flex flex-col justify-end">
                    <div
                      dir="ltr"
                      className="text-xs font-mono text-[#64748B] dark:text-[#94A3B8] mb-1.5"
                    >
                      Previous line
                    </div>
                    {previousSegment ? (
                      <p
                        style={{ fontSize: `${previousFontSize}px` }}
                        className={`font-medium text-[#64748B] dark:text-[#94A3B8] ${
                          isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                        }`}
                      >
                        {prevText ||
                          (previousSegment.status === 'translating'
                            ? '…'
                            : 'translation unavailable')}
                      </p>
                    ) : (
                      <p
                        dir="ltr"
                        className="text-sm text-slate-400 dark:text-slate-600 italic"
                      >
                        No preceding sentence yet
                      </p>
                    )}
                  </div>
                )}

                {/* Current Translated Line */}
                <div className="flex-1 flex flex-col justify-center">
                  {currentSegment ? (
                    isTranslating ? (
                      <p
                        style={{ fontSize: `${Math.round(fontSize * 0.8)}px` }}
                        className="font-medium text-[#64748B] dark:text-[#94A3B8] animate-pulse"
                      >
                        Translating…
                      </p>
                    ) : isUnavailable ? (
                      <p
                        dir="ltr"
                        className="text-lg font-medium text-amber-600 dark:text-amber-400 italic"
                      >
                        translation unavailable
                      </p>
                    ) : (
                      <p
                        style={{ fontSize: `${fontSize}px` }}
                        className={`font-bold tracking-tight ${
                          isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                        }`}
                      >
                        <CaptionText color={captionColor} isDark={isDark}>
                          {currText}
                        </CaptionText>
                      </p>
                    )
                  ) : (
                    <p
                      dir="ltr"
                      className="text-base text-slate-400 dark:text-slate-600"
                    >
                      {lang.name} translation will appear here as each sentence completes.
                    </p>
                  )}

                  {/* Live translation of in-progress speech (dimmed, mirrors English interim) */}
                  {interimTranscript.trim().length > 0 && liveTranslations[code] && (
                    <p
                      style={{ fontSize: `${fontSize}px` }}
                      className={`pt-4 font-semibold italic opacity-70 ${
                        isRtl ? 'caption-text-rtl' : 'caption-text-ltr'
                      }`}
                    >
                      <CaptionText color={captionColor} isDark={isDark}>
                        {liveTranslations[code]}
                      </CaptionText>
                    </p>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
