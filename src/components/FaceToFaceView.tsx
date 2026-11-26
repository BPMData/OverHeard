import { useEffect, useRef, type ReactNode } from 'react';
import { LANGUAGE_MAP } from '../constants';
import { captionTextStyle, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import type { Message, Side } from '../conversation/state';
import type { useConversationSpeech } from '../conversation/useConversationSpeech';
import type { ConversationLanguage } from '../types';
import type { ConversationSettings } from './conversationSettings';

type Speech = ReturnType<typeof useConversationSpeech>;

const direction = (lang: ConversationLanguage) => (lang === 'en' ? 'ltr' : LANGUAGE_MAP[lang].dir);
const color = (side: Side, lang: ConversationLanguage) =>
  side === 'a'
    ? lang === 'en'
      ? ENGLISH_CAPTION_COLOR
      : languageCaptionColor(0)
    : languageCaptionColor(1);

interface FaceToFaceViewProps {
  settings: ConversationSettings;
  speech: Speech;
  messages: Message[];
  fontSize: number;
  isDark: boolean;
  packPanel?: ReactNode;
  uiError: string;
  /** Starts listening with this person talking first */
  onStart: (side: Side) => void;
  onAdjustFont?: (delta: number) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
}

/**
 * Two-way for a tablet lying flat between two people. Each person gets half the screen and
 * a big button at their own edge; side B's half is turned upside down for the person across
 * the table. Both halves show the whole conversation, so a wrongly guessed speaker only
 * changes a name label, never what anyone can read.
 */
export function FaceToFaceView({
  settings, speech, messages, fontSize, isDark, packPanel, uiError, onStart, onAdjustFont,
  fullscreen, onToggleFullscreen, controlsOpen, onToggleControls,
}: FaceToFaceViewProps) {
  const threads = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
  const following = useRef({ a: true, b: true });
  const live = [speech.draft, speech.interim].filter(Boolean).join(' ');
  useEffect(() => {
    for (const side of ['a', 'b'] as const) {
      const el = threads[side].current;
      if (el && following.current[side]) el.scrollTop = el.scrollHeight;
    }
  }, [messages, live]);
  const name = (side: Side) => settings[side].name || side.toUpperCase();

  const pane = (reader: Side) => {
    const isTurn = speech.isListening && speech.turn === reader;
    return (
      <section
        className={`f2f-pane f2f-${reader === 'b' ? 'far' : 'near'}`}
        aria-label={`${name(reader)}’s half of the screen`}
      >
        <div
          className="f2f-thread"
          ref={threads[reader]}
          role="log"
          aria-label={`Conversation for ${name(reader)}`}
          onScroll={() => {
            const el = threads[reader].current!;
            following.current[reader] = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {!messages.length && !live && (
            <p className="conversation-empty">
              {speech.isListening
                ? 'Go ahead and talk. Your words show up here.'
                : 'Tap the big button, then talk.'}
            </p>
          )}
          {messages.map((message) => {
            const own = message.side === reader;
            const done = message.status === 'done';
            // You read your own words as said; the other person's arrive in your language
            const shown = own || !done ? message.original : message.translated || message.original;
            const lang = own || !done ? message.sender.lang : message.reader.lang;
            return (
              <article
                key={message.id}
                className={`f2f-message ${own ? 'is-own' : 'is-other'}`}
              >
                <small>{message.sender.name}</small>
                <div
                  dir={direction(lang)}
                  lang={lang}
                  style={{
                    fontSize: own ? Math.round(fontSize * 0.6) : fontSize,
                    ...captionTextStyle(color(message.side, message.sender.lang), isDark),
                  }}
                >
                  {shown}
                </div>
                {!own && message.status === 'translating' && (
                  <small className="conversation-pulse">Translating…</small>
                )}
                {!own && message.status === 'error' && (
                  <small className="conversation-error">translation unavailable</small>
                )}
              </article>
            );
          })}
          {live && (
            <article
              className={`f2f-message is-live ${speech.turn === reader ? 'is-own' : 'is-other'}`}
            >
              <small>{name(speech.turn)} · speaking…</small>
              <div
                dir={direction(settings[speech.turn].lang)}
                lang={settings[speech.turn].lang}
                style={{
                  fontSize: speech.turn === reader ? Math.round(fontSize * 0.6) : fontSize,
                  ...captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark),
                }}
              >
                {live}
              </div>
            </article>
          )}
        </div>
        <button
          type="button"
          className={`f2f-talk ${isTurn ? 'is-turn' : ''}`}
          aria-pressed={isTurn}
          disabled={!speech.supported}
          onClick={() => (speech.isListening ? speech.setTurn(reader) : onStart(reader))}
        >
          {isTurn ? `🎙 Listening to ${name(reader)}` : `${name(reader)}: tap, then talk`}
        </button>
      </section>
    );
  };

  return (
    <>
      {packPanel}
      {(uiError || speech.error || !speech.supported) && (
        <p role="alert">
          {uiError ||
            speech.error ||
            'Speech recognition is unavailable in this browser. Switch Layout to Side by side to type messages.'}
        </p>
      )}
      <div className="f2f">
        {pane('b')}
        <div className="f2f-divider" role="group" aria-label="Conversation controls">
          <span
            role="status"
            className={speech.isListening ? 'conversation-pulse' : undefined}
          >
            {speech.isListening ? `Listening to ${name(speech.turn)}` : 'Stopped'}
          </span>
          {speech.isListening ? (
            <button type="button" onClick={speech.stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="conversation-start"
              disabled={!speech.supported}
              onClick={() => onStart(speech.turn)}
            >
              Start
            </button>
          )}
          {onAdjustFont && (
            <>
              <button type="button" aria-label="Smaller text" onClick={() => onAdjustFont(-4)}>
                A−
              </button>
              <button type="button" aria-label="Larger text" onClick={() => onAdjustFont(4)}>
                A+
              </button>
            </>
          )}
          <button type="button" onClick={onToggleFullscreen}>
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
          <button type="button" aria-expanded={controlsOpen} onClick={onToggleControls}>
            {controlsOpen ? 'Hide controls' : 'Show controls'}
          </button>
        </div>
        {pane('a')}
      </div>
    </>
  );
}
