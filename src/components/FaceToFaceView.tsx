import { memo, useEffect, useRef, type ReactNode } from 'react';
import { LANGUAGE_MAP } from '../constants';
import { captionTextStyle, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import { speechLocale } from '../conversation/locales';
import { correctMessage, otherSide, type Message, type Side } from '../conversation/state';
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
  onCorrectMessage: (message: Message) => void;
  onToggleManualTurns: () => void;
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

// Interim captions change on every recognition event. Completed rows only depend on these props.
const ReaderHistory = memo(function ReaderHistory({
  reader, messages, fontSize, isDark, onCorrectMessage,
}: Pick<FaceToFaceViewProps, 'messages' | 'fontSize' | 'isDark' | 'onCorrectMessage'> & { reader: Side }) {
  return messages.map((message) => {
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
        <div className="f2f-message-head">
          <small>{message.sender.name}</small>
          <button
            type="button"
            className="f2f-swap"
            aria-label={`Move "${message.original}" to ${message.reader.name}`}
            title={`Move to ${message.reader.name}`}
            onClick={() => onCorrectMessage(correctMessage(message))}
          >
            ⇄
          </button>
        </div>
        <div
          dir={direction(lang)}
          lang={lang}
          style={{ fontSize: own ? Math.round(fontSize * 0.6) : fontSize }}
        >
          <span style={captionTextStyle(color(message.side, message.sender.lang), isDark)}>
            {shown}
          </span>
        </div>
        {!own && message.status === 'translating' && (
          <small className="conversation-pulse">Translating…</small>
        )}
        {!own && message.status === 'error' && (
          <small className="conversation-error">translation unavailable</small>
        )}
      </article>
    );
  });
});

/**
 * Two-way for a tablet lying flat between two people. Each person gets half the screen and
 * a big button at their own edge; side B's half is turned upside down for the person across
 * the table. Both halves show the whole conversation, so a wrongly guessed speaker only
 * changes a name label, never what anyone can read.
 */
export function FaceToFaceView({
  settings, speech, messages, onCorrectMessage, onToggleManualTurns, fontSize, isDark,
  packPanel, uiError, onStart, onAdjustFont, fullscreen, onToggleFullscreen, controlsOpen,
  onToggleControls,
}: FaceToFaceViewProps) {
  const threads = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
  const following = useRef({ a: true, b: true });
  const turnActivatedAtRef = useRef(0);
  const live = [speech.draft, speech.interim].filter(Boolean).join(' ');
  const sameSpeechLang = speechLocale(settings.a.lang) === speechLocale(settings.b.lang);
  useEffect(() => {
    for (const side of ['a', 'b'] as const) {
      const el = threads[side].current;
      if (el && following.current[side]) el.scrollTop = el.scrollHeight;
    }
  }, [messages, live, fontSize]);
  const name = (side: Side) => settings[side].name || side.toUpperCase();

  const handleTalkClick = (reader: Side) => {
    if (!speech.isListening) {
      turnActivatedAtRef.current = Date.now();
      onStart(reader);
      return;
    }
    if (speech.turn === reader) {
      // Ignore an accidental double-tap right after starting before any words arrive.
      if (!live && Date.now() - turnActivatedAtRef.current < 600) return;
      speech.setTurn(otherSide(reader));
      return;
    }
    turnActivatedAtRef.current = Date.now();
    speech.setTurn(reader);
  };

  const pane = (reader: Side) => {
    const isTurn = speech.isListening && speech.turn === reader;
    const other = otherSide(reader);
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
                ? isTurn
                  ? 'Listening to you — go ahead and talk.'
                  : `Listening to ${name(other)} — their words will appear here.`
                : 'Tap your button below, then talk.'}
            </p>
          )}
          <ReaderHistory reader={reader} messages={messages} fontSize={fontSize} isDark={isDark} onCorrectMessage={onCorrectMessage} />
          {live && (
            <article
              className={`f2f-message is-live ${speech.turn === reader ? 'is-own' : 'is-other'}`}
            >
              <div className="f2f-message-head">
                <small>{name(speech.turn)} · speaking…</small>
                {sameSpeechLang && (
                  <button
                    type="button"
                    className="f2f-swap"
                    aria-label={`Switch live speech to ${name(otherSide(speech.turn))}`}
                    title={`Switch to ${name(otherSide(speech.turn))}`}
                    onClick={() => speech.reassignTurn(otherSide(speech.turn))}
                  >
                    ⇄
                  </button>
                )}
              </div>
              <div
                dir={direction(settings[speech.turn].lang)}
                lang={settings[speech.turn].lang}
                style={{ fontSize: speech.turn === reader ? Math.round(fontSize * 0.6) : fontSize }}
              >
                <span style={captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark)}>
                  {live}
                </span>
              </div>
            </article>
          )}
        </div>
        <button
          type="button"
          className={`f2f-talk ${isTurn ? 'is-turn' : ''}`}
          aria-pressed={isTurn}
          disabled={!speech.supported}
          onClick={() => handleTalkClick(reader)}
        >
          {isTurn ? (
            <>
              {`🎙 Listening to ${name(reader)}`}{' '}
              <span className="f2f-talk-hint">· Tap when done</span>
            </>
          ) : (
            `${name(reader)}: tap, then talk`
          )}
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
          <button
            type="button"
            aria-pressed={!settings.manualTurns}
            onClick={onToggleManualTurns}
            title={
              settings.manualTurns
                ? 'Tap buttons to switch speakers. Click for hands-free auto-switching.'
                : `Auto-switches after a ${settings.switchAfterMs / 1000}s pause. Click to switch by tapping.`
            }
          >
            {settings.manualTurns ? 'Turns: Tap' : 'Turns: Auto'}
          </button>
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
