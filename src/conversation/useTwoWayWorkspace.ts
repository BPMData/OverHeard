import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type React from 'react';
import { SUPPORTED_LANGUAGES } from '../constants';
import { createMessage, messagesReducer, otherSide, type Message, type Side } from './state';
import { useConversationSpeech } from './useConversationSpeech';
import { withMicAccess } from '../micPermission';
import { isOnDeviceTranslationSupported, prepareOfflineSpeechIfTranslatorsReady, prepareOnDeviceConversation } from '../onDevice';
import { speechLocale } from './locales';
import { speechLocality } from '../offline';
import { conversationJson, parseConversationJson } from '../components/conversationSettings';
import { useTwoWayPlayback } from '../tts/useSpeechPlayback';
import { piperClient } from '../tts/piperClient';
import { resolveVoiceId } from '../tts/voices';
import type { ConversationModeProps } from '../components/ConversationMode';
import type { ConversationSettings } from '../components/conversationSettings';
import type { VoicePreferences } from '../tts/voices';

type Shared = Pick<ConversationModeProps, 'active' | 'translate' | 'mtPreference' | 'onStartAttempt' | 'onPermissionDenied' | 'onPackProgress'> & {
  settings: ConversationSettings;
  voicePrefs: VoicePreferences;
};

type Options = Shared & { setUiError: (message: string) => void };
export function useTwoWayWorkspace({ active, translate, mtPreference, onStartAttempt, onPermissionDenied,
  onPackProgress, settings, voicePrefs, setUiError }: Options) {
  const isLecture = settings.mode === 'lecture';
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const onCorrectMessage = useCallback((message: Message) => dispatch({ type: 'correct', message }), []);
  const [sender, setSender] = useState<Side>('a');
  const [text, setText] = useState('');
  const [newMessage, setNewMessage] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
    switchAfterMs: settings.manualTurns ? null : settings.switchAfterMs,
    onSend: send,
    onPermissionDenied,
    onUnsupportedLanguage: (language) =>
      setUiError(
        `Speech recognition doesn't support ${SUPPORTED_LANGUAGES.find((l) => l.code === language)?.name ?? 'English'} in this browser. You can type a message below.`,
      ),
  });
  const twoWayPlayback = useTwoWayPlayback({
    voicePrefs,
    onSuspendSpeech: speech.suspend,
    onResumeSpeech: speech.resume,
  });
  useEffect(() => {
    if (active && !isLecture && settings.manualTurns && speech.isListening)
      nextButton.current?.focus();
  }, [active, isLecture, settings.manualTurns, speech.isListening]);
  useEffect(() => {
    if (!active || isLecture) return;
    const handler = (event: KeyboardEvent) => {
      if (event.code === 'Space' && settings.manualTurns && speech.isListening) {
        const target = event.target;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (target instanceof Element &&
            target !== nextButton.current &&
            target.closest('button,a,summary,input,textarea,select,[contenteditable]'))
        )
          return;
        event.preventDefault();
        if (!event.repeat) speech.setTurn(otherSide(speech.turn));
        return;
      }
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
  }, [active, isLecture, settings.manualTurns, speech.isListening, speech.turn, speech.setTurn]);
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
    if (!active || isLecture || !settings.readAloud) return;
    const pending = messages.filter(
      (m) => m.status === 'done' && !spoken.current.has(`${m.id}:${m.revision}`),
    );
    if (!pending.length) return;
    const speakable = pending.filter(
      (m) =>
        piperClient.shouldUsePiper(m.reader.lang, resolveVoiceId(m.reader.lang, voicePrefs)) ||
        Boolean(window.speechSynthesis),
    );
    if (!speakable.length) return;
    speakable.forEach((m) => spoken.current.add(`${m.id}:${m.revision}`));
    twoWayPlayback.enqueueAuto(
      speakable.map((m) => ({
        id: m.id,
        text: m.translated || m.original,
        lang: m.reader.lang,
      })),
    );
  }, [messages, active, isLecture, settings.readAloud, voicePrefs, twoWayPlayback.enqueueAuto]);
  useEffect(() => {
    if (!settings.readAloud) messages.forEach((m) => spoken.current.add(`${m.id}:${m.revision}`));
  }, [messages, settings.readAloud]);
  useEffect(() => {
    if (following.current) {
      if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    } else if (messages.length) setNewMessage(true);
  }, [messages, speech.draft, speech.interim, active]);
  const start = () => startFrom('a');
  /** Starts listening with `side` talking first (Face to face: whoever tapped their button). */
  const startFrom = (side: Side) => {
    onStartAttempt?.();
    setUiError('');
    // Downloads need this click, and the automatic hand-off between speakers isn't one,
    // so fetch every pack both people will need now.
    const langs = { a: settings.a.lang, b: settings.b.lang };
    if (mtPreference === 'on-device') {
      prepareOnDeviceConversation(langs, onPackProgress);
    } else if (mtPreference === 'auto' && isOnDeviceTranslationSupported()) {
      // Auto translates on this device once packs are ready. Speech stays on Google's free
      // service while online; its packs are fetched once no translation pack needs the click,
      // so speech can switch over when offline.
      prepareOnDeviceConversation(langs, onPackProgress, { speech: false });
      if (langs.a !== langs.b) {
        prepareOfflineSpeechIfTranslatorsReady(
          [{ code: langs.b, source: langs.a }, { code: langs.a, source: langs.b }],
          [...new Set([langs.a, langs.b])].map((code) => ({ key: `speech:${code}`, locale: speechLocale(code) })),
          onPackProgress
        );
      }
    }
    withMicAccess(
      () => speech.start(speechLocality(mtPreference), side),
      (reason) => onPermissionDenied(reason),
    );
  };
  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([conversationJson(messages, settings)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content =
        typeof file.text === 'function' ? await file.text() : await new Response(file).text();
      const imported = parseConversationJson(content, settings);
      setUiError('');
      imported.forEach((m) => {
        if (m.status === 'done') spoken.current.add(`${m.id}:${m.revision}`);
      });
      dispatch({ type: 'import', messages: imported });
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Could not import JSON.');
    }
  };
  const stopTwoWayWorkspace = () => { speech.stop(); twoWayPlayback.cancelAll(); };
  return { messages, dispatch, onCorrectMessage, sender, setSender, text, setText, newMessage,
    setNewMessage, thread, nextButton, fileInput, following, send, speech, twoWayPlayback,
    start, startFrom, exportJson, importJson, stopTwoWayWorkspace };
}
