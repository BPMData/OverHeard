import type { ChangeEvent, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { LANGUAGE_MAP, SUPPORTED_LANGUAGES } from '../constants';
import { captionTextStyle, ENGLISH_CAPTION_COLOR, languageCaptionColor } from '../captionColors';
import { correctMessage, otherSide, type Message, type Side } from '../conversation/state';
import type { useConversationSpeech } from '../conversation/useConversationSpeech';
import { piperClient } from '../tts/piperClient';
import type { useTwoWayPlayback } from '../tts/useSpeechPlayback';
import { BROWSER_VOICE_ID, resolveVoiceId, type VoicePreferences } from '../tts/voices';
import { VoiceSelect } from '../tts/VoiceSelect';
import type { ConversationLanguage } from '../types';
import type { ConversationSettings } from './conversationSettings';

type SettingsSetter = Dispatch<SetStateAction<ConversationSettings>>;
type Speech = ReturnType<typeof useConversationSpeech>;
type Playback = ReturnType<typeof useTwoWayPlayback>;

interface TwoWaySettingsProps {
  settings: ConversationSettings;
  setSettings: SettingsSetter;
  speech: Speech;
  voicePrefs: VoicePreferences;
  updateVoicePref: (lang: ConversationLanguage, voiceId: string) => void;
  translatorPicker?: ReactNode;
  start: () => void;
  onClear: () => void;
  exportJson: () => void;
  importJson: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  fileInput: RefObject<HTMLInputElement | null>;
}

export function TwoWaySettings({
  settings, setSettings, speech, voicePrefs, updateVoicePref, translatorPicker,
  start, onClear, exportJson, importJson, fileInput,
}: TwoWaySettingsProps) {
  return (
    <>
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
          {/* A select can't hold the glow's ::after layer, so a wrapper carries it */}
          <span className="oh-beckon oh-beckon-wrap">
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
          </span>
          <VoiceSelect
            lang={settings[side].lang}
            ariaLabel={`Side ${side.toUpperCase()} voice`}
            value={resolveVoiceId(settings[side].lang, voicePrefs)}
            onChange={(voiceId) => updateVoicePref(settings[side].lang, voiceId)}
          />
          <button onClick={() => speech.setTurn(side)}>
            {settings[side].name === 'Me'
              ? 'My turn'
              : `${settings[side].name || side.toUpperCase()}'s turn`}
          </button>
        </fieldset>
      ))}
      <label>
        Turn-taking
        <select
          value={settings.manualTurns ? 'manual' : 'auto'}
          onChange={(e) =>
            setSettings((s) => ({ ...s, manualTurns: e.target.value === 'manual' }))
          }
        >
          <option value="auto">Hands-free</option>
          <option value="manual">Manual · Spacebar</option>
        </select>
      </label>
      {!settings.manualTurns && (
        <label>
          Switch after{' '}
          <select
            value={settings.switchAfterMs}
            onChange={(e) =>
              setSettings((s) => ({ ...s, switchAfterMs: Number(e.target.value) }))
            }
          >
            {[1000, 1500, 2500, 3500, 5000].map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000} s
              </option>
            ))}
          </select>
        </label>
      )}
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
        className={`conversation-start ${speech.isListening ? 'is-listening' : ''}`}
        onClick={speech.isListening ? speech.stop : start}
        disabled={!speech.supported}
      >
        {speech.isListening ? 'Pause conversation' : 'Start conversation'}
      </button>
      <button
        onClick={() => {
          if (window.confirm('Clear the whole conversation?')) onClear();
        }}
      >
        Clear conversation
      </button>
      <button type="button" onClick={exportJson}>Export JSON</button>
      <button type="button" onClick={() => fileInput.current?.click()}>Import JSON</button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Import JSON file"
        hidden
        onChange={importJson}
      />
    </>
  );
}

export function TwoWayReadAloud({
  settings, setSettings, voicePrefs, speech, twoWayPlayback,
}: {
  settings: ConversationSettings;
  setSettings: SettingsSetter;
  voicePrefs: VoicePreferences;
  speech: Speech;
  twoWayPlayback: Playback;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={settings.readAloud}
        onChange={(e) => {
          const checked = e.target.checked;
          setSettings((s) => ({ ...s, readAloud: checked }));
          if (checked) {
            piperClient.unlockAudio();
            const voiceA = resolveVoiceId(settings.a.lang, voicePrefs);
            const voiceB = resolveVoiceId(settings.b.lang, voicePrefs);
            if (voiceA !== BROWSER_VOICE_ID) piperClient.preloadVoice(voiceA);
            if (voiceB !== BROWSER_VOICE_ID) piperClient.preloadVoice(voiceB);
          } else {
            twoWayPlayback.cancelAll();
            speech.resume();
          }
        }}
      />
      Read aloud
    </label>
  );
}

const direction = (lang: ConversationLanguage) => (lang === 'en' ? 'ltr' : LANGUAGE_MAP[lang].dir);
const color = (side: Side, lang: ConversationLanguage) =>
  side === 'a'
    ? lang === 'en'
      ? ENGLISH_CAPTION_COLOR
      : languageCaptionColor(0)
    : languageCaptionColor(1);

interface TwoWayViewProps {
  settings: ConversationSettings;
  speech: Speech;
  twoWayPlayback: Playback;
  fontSize: number;
  isDark: boolean;
  packPanel?: ReactNode;
  uiError: string;
  thread: RefObject<HTMLDivElement | null>;
  following: RefObject<boolean>;
  messages: Message[];
  onCorrectMessage: (message: Message) => void;
  newMessage: boolean;
  setNewMessage: (value: boolean) => void;
  nextButton: RefObject<HTMLButtonElement | null>;
  send: (side: Side, value: string) => void;
  sender: Side;
  setSender: (side: Side) => void;
  text: string;
  setText: (value: string) => void;
}

export function TwoWayView({
  settings, speech, twoWayPlayback, fontSize, isDark, packPanel, uiError, thread, following,
  messages, onCorrectMessage, newMessage, setNewMessage, nextButton, send, sender, setSender,
  text, setText,
}: TwoWayViewProps) {
  const renderMessage = (message: Message) => {
    const placedSide = settings.placement === 'speaker' ? message.side : otherSide(message.side);
    const done = message.status === 'done';
    const canPlay = message.status !== 'translating';
    const isSpeakingThisBubble = twoWayPlayback.playingMessageId === message.id;
    const isDownloadingThisBubble =
      isSpeakingThisBubble && twoWayPlayback.downloadingMessageId === message.id;
    const spokenText = (done && message.translated) || message.original;
    const spokenLang = done && message.translated ? message.reader.lang : message.sender.lang;
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
          <span className="lecture-play-actions">
            {canPlay && (
              <button
                type="button"
                className={`conversation-play-btn ${isSpeakingThisBubble ? 'is-playing' : ''}`}
                aria-label={
                  isSpeakingThisBubble
                    ? `Stop reading ${message.original}`
                    : `Read aloud: ${message.original}`
                }
                title={isSpeakingThisBubble ? 'Stop reading' : 'Play translated speech'}
                onClick={() =>
                  twoWayPlayback.togglePlayMessage({
                    id: message.id,
                    text: spokenText,
                    lang: spokenLang,
                  })
                }
              >
                {isSpeakingThisBubble ? (
                  <>
                    <Square size={10} aria-hidden="true" />
                    <span>{isDownloadingThisBubble ? 'Loading…' : 'Stop'}</span>
                  </>
                ) : (
                  <>
                    <Volume2 size={12} aria-hidden="true" />
                    <span>Play</span>
                  </>
                )}
              </button>
            )}
            <button
              aria-label={`Correct speaker for ${message.original}`}
              title="Move to the other speaker"
              onClick={() => onCorrectMessage(correctMessage(message))}
            >
              ⇄
            </button>
          </span>
        </div>
        <div
          style={{ fontSize }}
          dir={direction(done ? message.reader.lang : message.sender.lang)}
          lang={done ? message.reader.lang : message.sender.lang}
        >
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
            lang={message.sender.lang}
          >
            {message.original}
          </div>
        )}
      </article>
    );
  };
  return (
    <>
      <p className="conversation-help">
        Each message uses the current speaker’s name.{' '}
        {settings.manualTurns
          ? 'Press Space or click Next speaker to pass the turn.'
          : 'Pause to send and pass the turn.'}{' '}
        Use ⇄ to correct a speaker. Left Shift: {settings.a.name}; Right Shift: {settings.b.name}.
      </p>
      {packPanel}
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
              lang={settings[speech.turn].lang}
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
        {settings.manualTurns && speech.isListening && (
          <button
            type="button"
            ref={nextButton}
            className="conversation-next-speaker conversation-start"
            aria-keyshortcuts="Space"
            onClick={() => speech.setTurn(otherSide(speech.turn))}
          >
            Next speaker · {settings[otherSide(speech.turn)].name} <kbd>Space</kbd>
          </button>
        )}
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
    </>
  );
}
