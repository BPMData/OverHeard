import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { LANGUAGE_MAP, SUPPORTED_LANGUAGES } from '../constants';
import { captionTextStyle, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import type { ConversationLanguage } from '../types';
import {
  createMessage,
  correctMessage,
  messagesReducer,
  otherSide,
  type Message,
  type Side,
} from '../conversation/state';
import { useConversationSpeech } from '../conversation/useConversationSpeech';
import { prepareOnDeviceTranslators } from '../onDevice';
import {
  conversationCsv,
  loadConversationSettings,
  saveConversationSettings,
} from './conversationSettings';
import './ConversationMode.css';

interface Props {
  active: boolean;
  fontSize: number;
  isDark: boolean;
  translate: (
    text: string,
    target: ConversationLanguage,
    source: ConversationLanguage,
  ) => Promise<string>;
  onExit: () => void;
  onStartAttempt?: () => void;
  onPermissionDenied: () => void;
  initialLanguage?: ConversationLanguage;
  mtPreference: string;
  translatorPicker?: React.ReactNode;
  onAdjustFont?: (delta: number) => void;
  permissionBanner?: React.ReactNode;
}
const direction = (lang: ConversationLanguage) => (lang === 'en' ? 'ltr' : LANGUAGE_MAP[lang].dir);
const color = (side: Side, lang: ConversationLanguage) =>
  side === 'a'
    ? lang === 'en'
      ? ENGLISH_CAPTION_COLOR
      : languageCaptionColor(0)
    : languageCaptionColor(1);
export function ConversationMode({
  active,
  fontSize,
  isDark,
  translate,
  onExit,
  onStartAttempt,
  onPermissionDenied,
  initialLanguage,
  mtPreference,
  translatorPicker,
  onAdjustFont,
  permissionBanner,
}: Props) {
  const [settings, setSettings] = useState(() => loadConversationSettings(initialLanguage));
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [sender, setSender] = useState<Side>('a');
  const [text, setText] = useState('');
  const [newMessage, setNewMessage] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [uiError, setUiError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const requests = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  const send = useCallback(
    (side: Side, value: string) => {
      if (value.trim())
        dispatch({ type: 'add', message: createMessage(side, value.trim(), settings) });
    },
    [settings],
  );
  const speech = useConversationSpeech({
    participants: settings,
    switchAfterMs: settings.switchAfterMs,
    onSend: send,
    onPermissionDenied,
    onUnsupportedLanguage: (language) =>
      setUiError(
        `Speech recognition doesn't support ${SUPPORTED_LANGUAGES.find((l) => l.code === language)?.name ?? 'English'} in this browser. You can type a message below.`,
      ),
  });
  useEffect(() => saveConversationSettings(settings), [settings]);
  useEffect(() => {
    if (!active) {
      speech.stop();
      window.speechSynthesis?.cancel();
    }
  }, [active, speech.stop]);
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        speech.setTurn(event.code === 'ShiftLeft' ? 'a' : 'b');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, speech.setTurn]);
  useEffect(() => {
    for (const message of messages) {
      const key = `${message.id}:${message.revision}`;
      if (message.status !== 'translating' || requests.current.has(key)) continue;
      requests.current.add(key);
      void translate(message.original, message.reader.lang, message.sender.lang).then(
        (translated) =>
          dispatch({ type: 'resolve', id: message.id, revision: message.revision, translated }),
        () =>
          dispatch({
            type: 'resolve',
            id: message.id,
            revision: message.revision,
            translated: null,
          }),
      );
    }
  }, [messages, translate]);
  useEffect(() => {
    if (!active || !settings.readAloud || !window.speechSynthesis) return;
    const pending = messages.filter(
      (m) => m.status === 'done' && !spoken.current.has(`${m.id}:${m.revision}`),
    );
    if (!pending.length) return;
    speech.suspend();
    pending.forEach((message) => {
      spoken.current.add(`${message.id}:${message.revision}`);
      const utterance = new SpeechSynthesisUtterance(message.translated || message.original);
      utterance.lang = message.reader.lang;
      utterance.voice =
        window.speechSynthesis
          .getVoices()
          .find((v) => v.lang.toLowerCase().startsWith(message.reader.lang)) || null;
      utterance.onend = utterance.onerror = () => {
        if (!window.speechSynthesis.pending && !window.speechSynthesis.speaking) speech.resume();
      };
      window.speechSynthesis.speak(utterance);
    });
  }, [messages, active, settings.readAloud, speech.suspend, speech.resume]);
  useEffect(() => {
    if (!settings.readAloud) messages.forEach((m) => spoken.current.add(`${m.id}:${m.revision}`));
  }, [messages, settings.readAloud]);
  useEffect(() => {
    if (following.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    else if (messages.length) setNewMessage(true);
  }, [messages, speech.draft, speech.interim, active]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const exit = () => {
    speech.stop();
    window.speechSynthesis?.cancel();
    if (document.fullscreenElement === root.current) void document.exitFullscreen();
    onExit();
  };
  const start = () => {
    onStartAttempt?.();
    setUiError('');
    if (mtPreference === 'on-device' && settings.a.lang !== settings.b.lang) {
      void prepareOnDeviceTranslators([settings.b.lang], settings.a.lang);
      void prepareOnDeviceTranslators([settings.a.lang], settings.b.lang);
    }
    speech.start(mtPreference === 'on-device');
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([conversationCsv(messages)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const renderMessage = (message: Message) => {
    const placedSide = settings.placement === 'speaker' ? message.side : otherSide(message.side);
    const done = message.status === 'done';
    return (
      <article key={message.id} className={`conversation-bubble side-${placedSide}`}>
        <div className="conversation-meta">
          <span>
            {message.sender.name} ·{' '}
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </span>
          <button
            aria-label={`Correct speaker for ${message.original}`}
            title="Move to the other speaker"
            onClick={() => dispatch({ type: 'correct', message: correctMessage(message) })}
          >
            ⇄
          </button>
        </div>
        <div style={{ fontSize }} dir={direction(done ? message.reader.lang : message.sender.lang)}>
          <span style={captionTextStyle(color(message.side, message.sender.lang), isDark)}>
            {done ? message.translated || message.original : message.original}
          </span>
        </div>
        {message.status === 'translating' && (
          <small className="conversation-pulse">Translating…</small>
        )}
        {message.status === 'error' && (
          <small className="conversation-error">translation unavailable</small>
        )}
        {done && message.sender.lang !== message.reader.lang && (
          <div
            className="conversation-original"
            style={{ fontSize: fontSize * 0.6 }}
            dir={direction(message.sender.lang)}
          >
            {message.original}
          </div>
        )}
      </article>
    );
  };
  return (
    <div
      ref={root}
      className={`conversation-mode ${isDark ? 'conversation-dark' : ''}`}
      hidden={!active}
    >
      {permissionBanner}
      <div className="conversation-settings">
        {(['a', 'b'] as const).map((side) => (
          <fieldset key={side}>
            <legend>Side {side.toUpperCase()}</legend>
            <input
              aria-label={`Side ${side.toUpperCase()} name`}
              value={settings[side].name}
              onChange={(e) =>
                setSettings((s) => ({ ...s, [side]: { ...s[side], name: e.target.value } }))
              }
            />
            <select
              aria-label={`Side ${side.toUpperCase()} language`}
              value={settings[side].lang}
              disabled={speech.isListening}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  [side]: { ...s[side], lang: e.target.value as ConversationLanguage },
                }))
              }
            >
              <option value="en">English</option>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <button onClick={() => speech.setTurn(side)}>
              {settings[side].name === 'Me'
                ? 'My turn'
                : `${settings[side].name || side.toUpperCase()}'s turn`}
            </button>
          </fieldset>
        ))}
        <label>
          Switch after{' '}
          <select
            value={settings.switchAfterMs}
            onChange={(e) => setSettings((s) => ({ ...s, switchAfterMs: Number(e.target.value) }))}
          >
            {[1500, 2500, 3500, 5000].map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000} s
              </option>
            ))}
          </select>
        </label>
        <label>
          Bubbles on{' '}
          <select
            value={settings.placement}
            onChange={(e) =>
              setSettings((s) => ({ ...s, placement: e.target.value as 'speaker' | 'reader' }))
            }
          >
            <option value="speaker">Speaker's side</option>
            <option value="reader">Reader's side</option>
          </select>
        </label>
        {translatorPicker}
        <button
          className="conversation-start"
          onClick={speech.isListening ? speech.stop : start}
          disabled={!speech.supported}
        >
          {speech.isListening ? 'Stop conversation' : 'Start conversation'}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Clear the whole conversation?')) dispatch({ type: 'clear' });
          }}
        >
          Clear conversation
        </button>
        <button onClick={exportCsv}>Export CSV</button>
        <button
          onClick={() => {
            if (fullscreen) void document.exitFullscreen();
            else
              void root.current
                ?.requestFullscreen?.()
                .catch(() => setUiError('Full screen is unavailable in this browser.'));
          }}
        >
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        {onAdjustFont && (
          <>
            <button aria-label="Smaller conversation text" onClick={() => onAdjustFont(-4)}>
              A−
            </button>
            <button aria-label="Larger conversation text" onClick={() => onAdjustFont(4)}>
              A+
            </button>
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={settings.readAloud}
            onChange={(e) => {
              setSettings((s) => ({ ...s, readAloud: e.target.checked }));
              if (!e.target.checked) {
                window.speechSynthesis?.cancel();
                speech.resume();
              }
            }}
          />
          Read aloud
        </label>
        <button onClick={exit}>Exit</button>
      </div>
      <p className="conversation-help">
        Speakers are identified by their turn, not their voice. Take turns and pause to send. Use ⇄
        to correct a speaker. Left Shift: {settings.a.name}; Right Shift: {settings.b.name}.
      </p>
      {(uiError || speech.error || !speech.supported) && (
        <p role="alert">
          {uiError ||
            speech.error ||
            'Speech recognition is unavailable. You can type messages below.'}
        </p>
      )}
      <div
        className="conversation-thread"
        ref={thread}
        role="log"
        aria-label="Conversation messages"
        onScroll={() => {
          const el = thread.current!;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (following.current) setNewMessage(false);
        }}
      >
        {!messages.length && (
          <p className="conversation-empty">
            Start a conversation or type a message. Messages stay here until you clear them.
          </p>
        )}
        {messages.map(renderMessage)}
        {(speech.draft || speech.interim) && (
          <article className={`conversation-bubble side-${speech.turn}`}>
            <small>{settings[speech.turn].name} · speaking…</small>
            <div
              dir={direction(settings[speech.turn].lang)}
              style={{
                fontSize,
                ...captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark),
              }}
            >
              {[speech.draft, speech.interim].filter(Boolean).join(' ')}
            </div>
          </article>
        )}
      </div>
      {newMessage && (
        <button
          className="conversation-new"
          onClick={() => {
            following.current = true;
            if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
            setNewMessage(false);
          }}
        >
          ↓ New message
        </button>
      )}
      <footer>
        <div
          role="status"
          className={`conversation-listening ${speech.isListening ? 'conversation-pulse' : ''}`}
          style={
            speech.isListening
              ? captionTextStyle(color(speech.turn, settings[speech.turn].lang), isDark)
              : undefined
          }
        >
          {speech.isListening
            ? `Listening for ${settings[speech.turn].name}…`
            : 'Conversation stopped'}{' '}
          {speech.isListening && <small>🎙 {speech.speechLocal ? 'local' : 'cloud'}</small>}
        </div>
        <details>
          <summary>Type a message</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(sender, text);
              setText('');
            }}
          >
            <select
              aria-label="Message sender"
              value={sender}
              onChange={(e) => setSender(e.target.value as Side)}
            >
              <option value="a">{settings.a.name}</option>
              <option value="b">{settings.b.name}</option>
            </select>
            <input
              aria-label="Message text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type and press Enter"
            />
            <button disabled={!text.trim()}>Send</button>
          </form>
        </details>
      </footer>
    </div>
  );
}
