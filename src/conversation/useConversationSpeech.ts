import { appendDistinct, createFinalDeduper, dropLastWords, mergeInterim } from '../speechDedupe';
import { logSpeechEvent, logSpeechNote } from '../speechDebug';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareOnDeviceSpeech } from '../onDevice';
import { isFailedSession, restartDelay } from '../speechRestart';
import { speechLocale } from './locales';
import { otherSide, type Side } from './state';

interface ResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

function recognitionConstructor() {
  const globals = globalThis as unknown as {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  };
  return globals.SpeechRecognition ?? globals.webkitSpeechRecognition;
}

export interface ConversationSpeechOptions {
  participants: Record<Side, { lang: string }>;
  switchAfterMs: number | null;
  onSend: (side: Side, text: string) => void;
  onPermissionDenied?: () => void;
  onUnsupportedLanguage?: (lang: string) => void;
}

/** Generation tokens invalidate old callbacks and in-flight language-pack downloads. */
export function useConversationSpeech(options: ConversationSpeechOptions) {
  const opts = useRef(options);
  opts.current = options;
  const [isListening, setListening] = useState(false);
  const [turn, updateTurn] = useState<Side>('a');
  const [draft, updateDraft] = useState('');
  const [interim, updateInterim] = useState('');
  const [error, updateError] = useState<string | null>(null);
  const [speechLocal, setLocal] = useState<boolean | null>(null);
  const session = useRef({
    active: false,
    suspended: false,
    side: 'a' as Side,
    draft: '',
    interim: '',
    generation: 0,
    failures: 0,
    local: false,
  });
  const recognizer = useRef<Recognizer | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (silence.current !== null) clearTimeout(silence.current);
    if (restart.current !== null) clearTimeout(restart.current);
    silence.current = restart.current = null;
  }

  function detach() {
    const recognition = recognizer.current;
    recognizer.current = null;
    if (!recognition) return;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // It may already have ended.
    }
  }

  function invalidate() {
    session.current.generation++;
    clearTimers();
    detach();
  }

  function clearDraft() {
    session.current.draft = session.current.interim = '';
    updateDraft('');
    updateInterim('');
  }

  function send() {
    const current = session.current;
    const text = appendDistinct(current.draft, current.interim).trim();
    logSpeechNote(`send draft="${current.draft}" interim="${current.interim}"`);
    if (text) opts.current.onSend(current.side, text);
    clearDraft();
  }

  function stop() {
    session.current.active = false;
    session.current.suspended = false;
    invalidate();
    clearDraft();
    setListening(false);
  }

  function armSilence() {
    const current = session.current;
    const token = current.generation;
    if (silence.current !== null) clearTimeout(silence.current);
    const delay = opts.current.switchAfterMs;
    if (
      delay === null ||
      !current.active ||
      current.suspended ||
      !(current.draft || current.interim)
    )
      return;
    silence.current = setTimeout(() => {
      if (token !== current.generation || !current.active || current.suspended) return;
      send();
      handoff(otherSide(current.side));
    }, delay);
  }

  useEffect(() => {
    armSilence();
  }, [options.switchAfterMs]);

  // A replacement recognizer cannot revise an old recognizer's interim result.
  function preserveInterim() {
    const current = session.current;
    current.draft = appendDistinct(current.draft, current.interim);
    current.interim = '';
    updateDraft(current.draft);
    updateInterim('');
  }

  async function begin() {
    const current = session.current;
    const token = current.generation;
    if (!current.active || current.suspended) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      updateError('Speech recognition is unavailable in this browser. You can type a message.');
      stop();
      return;
    }
    const lang = opts.current.participants[current.side].lang;
    const locale = speechLocale(lang);
    const local = current.local ? await prepareOnDeviceSpeech(locale) : false;
    if (token !== current.generation || !current.active || current.suspended) return;
    setLocal(local);
    const recognition = new Constructor();
    recognizer.current = recognition;
    recognition.lang = locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.processLocally = local;
    const valid = () =>
      token === current.generation &&
      current.active &&
      !current.suspended &&
      recognizer.current === recognition;
    const startedAt = Date.now();
    let lastError: string | null = null;
    const finals = new Set<number>();
    const newWords = createFinalDeduper();

    recognition.onresult = (event) => {
      if (!valid()) return;
      logSpeechEvent(event);
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (!finals.has(index)) {
            finals.add(index);
            const { drop, add } = newWords.revise(text);
            current.draft = appendDistinct(dropLastWords(current.draft, drop), add);
          }
        } else {
          parts.push(text);
        }
      }
      current.interim = newWords.peek(mergeInterim(parts));
      updateDraft(current.draft);
      updateInterim(current.interim);
      current.failures = 0;
      armSilence();
    };

    recognition.onerror = ({ error: code }) => {
      if (!valid()) return;
      lastError = code;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        updateError('Microphone permission is required. You can type a message.');
        stop();
        opts.current.onPermissionDenied?.();
      } else if (code === 'language-not-supported') {
        updateError(`Speech recognition doesn't support ${lang} in this browser.`);
        stop();
        opts.current.onUnsupportedLanguage?.(lang);
      }
    };

    function scheduleRestart() {
      if (!valid()) return;
      logSpeechNote(`end (${lastError ?? 'ok'})`);
      // The turn's silence timer survives ordinary browser ends.
      preserveInterim();
      detach();
      current.failures = isFailedSession(lastError, Date.now() - startedAt)
        ? current.failures + 1
        : 0;
      restart.current = setTimeout(() => {
        if (token === current.generation && current.active && !current.suspended) void begin();
      }, restartDelay(current.failures));
    }
    recognition.onend = scheduleRestart;
    try {
      recognition.start();
    } catch {
      lastError = 'network';
      scheduleRestart();
    }
  }

  function handoff(side: Side) {
    invalidate();
    session.current.side = side;
    session.current.failures = 0;
    updateTurn(side);
    if (session.current.active && !session.current.suspended) void begin();
  }

  function setTurn(side: Side) {
    send();
    handoff(side);
  }

  function start(local = false, side: Side = 'a') {
    stop();
    session.current.active = true;
    session.current.local = local;
    updateError(null);
    setListening(true);
    handoff(side);
  }

  function suspend() {
    session.current.suspended = true;
    preserveInterim();
    invalidate();
  }

  function resume() {
    if (!session.current.suspended) return;
    session.current.suspended = false;
    if (session.current.active) {
      armSilence();
      void begin();
    }
  }

  useEffect(
    () => () => {
      session.current.active = false;
      invalidate();
    },
    [],
  );

  // Stable public controls let consumers safely use them in effect dependencies.
  const latestControls = useRef({ start, stop, setTurn, suspend, resume });
  latestControls.current = { start, stop, setTurn, suspend, resume };
  const controls = useMemo(
    () => ({
      start: (local = false, side: Side = 'a') => latestControls.current.start(local, side),
      stop: () => latestControls.current.stop(),
      setTurn: (side: Side) => latestControls.current.setTurn(side),
      suspend: () => latestControls.current.suspend(),
      resume: () => latestControls.current.resume(),
    }),
    [],
  );

  return {
    isListening,
    turn,
    draft,
    interim,
    error,
    speechLocal,
    supported: Boolean(recognitionConstructor()),
    ...controls,
  };
}
