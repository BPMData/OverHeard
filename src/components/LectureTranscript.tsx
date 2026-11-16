import React, { useEffect, useRef, useState } from 'react';
import { CaptionSwatch, CaptionText, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import { LANGUAGE_MAP } from '../constants';
import type { LectureEntry } from '../conversation/lectureState';
import type { ActivePlayback } from '../tts/useSpeechPlayback';
import type { ConversationLanguage, LanguageCode } from '../types';

interface LectureTranscriptProps {
  entries: LectureEntry[];
  selectedLangs: LanguageCode[];
  fontSize: number;
  isDark: boolean;
  isListening: boolean;
  speechLocal: boolean | null;
  interim: string;
  liveTranslations: Partial<Record<LanguageCode, string>>;
  onAddLine?: (text: string) => void;
  activePlayback?: ActivePlayback | null;
  onPlayFrom?: (entryId: string, lang: ConversationLanguage) => void;
  onTogglePause?: () => void;
  onStopPlayback?: () => void;
}

function formatLectureTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function LectureTranscript({
  entries,
  selectedLangs,
  fontSize,
  isDark,
  isListening,
  speechLocal,
  interim,
  liveTranslations,
  onAddLine,
  activePlayback,
  onPlayFrom,
  onTogglePause,
  onStopPlayback,
}: LectureTranscriptProps) {
  const [typedLine, setTypedLine] = useState('');
  const [hasNewContent, setHasNewContent] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  const renderCellActions = (entryId: string, rowNum: number, langCode: ConversationLanguage, langName: string) => {
    if (!onPlayFrom) return null;
    const isActive = activePlayback?.entryId === entryId && activePlayback.lang === langCode;
    const isPaused = isActive && activePlayback?.status === 'paused';
    const isDownloading = isActive && activePlayback?.status === 'downloading';
    const isPlaying = isActive && !isPaused;
    return (
      <span className="lecture-play-actions" dir="ltr">
        {isActive && (
          <span className="lecture-live-label">
            {isPaused ? 'Paused' : isDownloading ? 'Loading…' : 'Reading'}
          </span>
        )}
        <button
          type="button"
          className="lecture-play-btn"
          aria-label={
            isPlaying
              ? `Pause reading #${rowNum} in ${langName}`
              : isPaused
                ? `Resume reading #${rowNum} in ${langName}`
                : `Read from #${rowNum} in ${langName}`
          }
          title={isPlaying ? 'Pause reading' : isPaused ? 'Resume reading' : 'Read aloud from here'}
          onClick={() => {
            if (isActive && onTogglePause) onTogglePause();
            else onPlayFrom(entryId, langCode);
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        {isActive && onStopPlayback && (
          <button
            type="button"
            className="lecture-play-btn"
            aria-label={`Stop reading #${rowNum} in ${langName}`}
            title="Stop reading"
            onClick={onStopPlayback}
          >
            ⏹
          </button>
        )}
      </span>
    );
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (followingRef.current) {
      el.scrollTop = el.scrollHeight;
      setHasNewContent(false);
    } else if (entries.length > 0 || interim.trim().length > 0) {
      setHasNewContent(true);
    }
  }, [entries, interim, liveTranslations]);

  const colCount = 1 + selectedLangs.length;
  const gridTemplateColumns = `repeat(${colCount}, minmax(210px, 1fr))`;
  const hasInterim = interim.trim().length > 0;

  return (
    <>
      <div
        ref={scrollerRef}
        className="lecture-scroller"
        role="log"
        aria-label="Lecture transcript"
        onScroll={() => {
          const el = scrollerRef.current;
          if (!el) return;
          followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (followingRef.current) setHasNewContent(false);
        }}
      >
        <div className="lecture-grid" style={{ gridTemplateColumns }}>
          {/* Sticky Column Headers */}
          <div className="lecture-col-header">
            <div className="lecture-col-title">
              <span>English</span>
              <span className="lecture-col-sub">en-US · Teacher</span>
            </div>
          </div>

          {selectedLangs.map((code, langIndex) => {
            const lang = LANGUAGE_MAP[code];
            const color = languageCaptionColor(langIndex);
            return (
              <div key={`hdr-${code}`} className="lecture-col-header">
                <div className="lecture-col-title">
                  <CaptionSwatch color={color} />
                  <span>{lang.name}</span>
                  <span dir={lang.dir} className="lecture-col-sub">
                    {lang.nativeName}
                    {lang.dir === 'rtl' ? ' · RTL' : ''}
                  </span>
                </div>
                <span className="lecture-col-code">{code}</span>
              </div>
            );
          })}

          {/* Empty Zero-State */}
          {entries.length === 0 && !hasInterim && (
            <div className="lecture-empty-cell">
              <p className="conversation-empty">
                {onAddLine ? 'Start lecture or type a line below. Spoken English and live translations stay saved here in side-by-side columns until you clear them.'
                  : 'Waiting for your teacher. Captions will appear here as the lecture begins.'}
              </p>
            </div>
          )}

          {/* Finalized Chronological Rows */}
          {entries.map((entry, idx) => {
            const isEnActive = activePlayback?.entryId === entry.id && activePlayback.lang === 'en';
            return (
              <React.Fragment key={entry.id}>
                <div className={`lecture-cell lecture-cell-en ${isEnActive ? 'lecture-cell-speaking' : ''}`}>
                  <div className="lecture-meta">
                    <span>#{idx + 1} · {formatLectureTime(entry.timestamp)}</span>
                    {renderCellActions(entry.id, idx + 1, 'en', 'English')}
                  </div>
                  <div style={{ fontSize }} className="caption-text-ltr font-semibold">
                    <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                      {entry.english}
                    </CaptionText>
                  </div>
                </div>

                {selectedLangs.map((code, langIndex) => {
                  const lang = LANGUAGE_MAP[code];
                  const color = languageCaptionColor(langIndex);
                  const translated = entry.translations[code];
                  const failed = entry.failedLangs[code];
                  const isCellActive = activePlayback?.entryId === entry.id && activePlayback.lang === code;
                  return (
                    <div
                      key={`${entry.id}-${code}`}
                      className={`lecture-cell ${isCellActive ? 'lecture-cell-speaking' : ''}`}
                      dir={lang.dir}
                    >
                      {translated ? (
                        <>
                          {onPlayFrom && (
                            <div className="lecture-meta" dir="ltr">
                              <span />
                              {renderCellActions(entry.id, idx + 1, code, lang.name)}
                            </div>
                          )}
                          <div
                            style={{ fontSize }}
                            className={`font-semibold ${
                              lang.dir === 'rtl' ? 'caption-text-rtl' : 'caption-text-ltr'
                            }`}
                          >
                            <CaptionText color={color} isDark={isDark}>
                              {translated}
                            </CaptionText>
                          </div>
                        </>
                      ) : failed ? (
                        <small dir="ltr" className="conversation-error">
                          translation unavailable
                        </small>
                      ) : (
                        <small dir="ltr" className="conversation-pulse">
                          Translating…
                        </small>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}

          {/* Live Streaming Row */}
          {hasInterim && (
            <>
              <div className="lecture-cell lecture-cell-en lecture-cell-live">
                <div className="lecture-meta lecture-live-label">Speaking live…</div>
                <div style={{ fontSize }} className="caption-text-ltr font-semibold italic opacity-75">
                  <CaptionText color={ENGLISH_CAPTION_COLOR} isDark={isDark}>
                    {interim}
                  </CaptionText>
                </div>
              </div>

              {selectedLangs.map((code, langIndex) => {
                const lang = LANGUAGE_MAP[code];
                const color = languageCaptionColor(langIndex);
                const liveText = liveTranslations[code];
                return (
                  <div
                    key={`live-${code}`}
                    className="lecture-cell lecture-cell-live"
                    dir={lang.dir}
                  >
                    {liveText ? (
                      <div
                        style={{ fontSize }}
                        className={`font-semibold italic opacity-75 ${
                          lang.dir === 'rtl' ? 'caption-text-rtl' : 'caption-text-ltr'
                        }`}
                      >
                        <CaptionText color={color} isDark={isDark}>
                          {liveText}
                        </CaptionText>
                      </div>
                    ) : (
                      <small dir="ltr" className="conversation-pulse">
                        Translating…
                      </small>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {hasNewContent && (
        <button
          type="button"
          className="conversation-new"
          onClick={() => {
            followingRef.current = true;
            if (scrollerRef.current) {
              scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
            }
            setHasNewContent(false);
          }}
        >
          ↓ Jump to latest
        </button>
      )}

      <footer>
        <div
          role="status"
          className={`conversation-listening ${isListening ? 'conversation-pulse' : ''}`}
          style={{ color: isListening ? (isDark ? ENGLISH_CAPTION_COLOR : '#0F172A') : undefined }}
        >
          {onAddLine ? (isListening ? 'Listening continuously in English…' : 'Lecture stopped')
            : (isListening ? 'Teacher is speaking · Live captions' : 'Waiting for teacher to resume')}{' '}
          {isListening && onAddLine && <small>🎙 {speechLocal ? 'local' : 'cloud'}</small>}
        </div>
        {onAddLine && <details>
          <summary>Type a line</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!typedLine.trim()) return;
              onAddLine(typedLine);
              setTypedLine('');
            }}
          >
            <input
              aria-label="Lecture line text"
              value={typedLine}
              onChange={(e) => setTypedLine(e.target.value)}
              placeholder="Type an English sentence to add to the lecture transcript"
            />
            <button type="submit" disabled={!typedLine.trim()}>
              Send
            </button>
          </form>
        </details>}
      </footer>
    </>
  );
}
