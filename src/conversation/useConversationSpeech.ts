import {
  appendDistinct, createFinalDeduper, dropLastWords, mergeInterim, stripEcho,
} from '../speechDedupe';
import { logSpeechEvent, logSpeechNote } from '../speechDebug';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareOnDeviceSpeech } from '../onDevice';
import { isFailedSession, restartDelay } from '../speechRestart';
import { speechLocale } from './locales';
import { isOffline, wantsLocalSpeech, type SpeechLocality } from '../offline';
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
  onstart?: (() => void) | null;
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

/**
 * Restart gaps don't count toward the pause before the turn passes, but they can't hold it
 * forever either: an Android tablet ends and restarts its session again and again in a quiet
 * room, and each restart used to start the pause over, so Auto never passed the turn. Once
 * nothing new has been heard for the pause plus this long, the turn passes anyway.
 */
export const TURN_GRACE_MS = 3000;

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
    local: false as SpeechLocality,
    /**
     * Unfinished words already sent with the previous turn. The shared recognizer will still
     * deliver them as a final, which must not open the next person's message.
     */
    echo: '',
    /** When the current speaker's words last changed, for the turn's wall-clock limit. */
    heardAt: 0,
  });
  const recognizer = useRef<Recognizer | null>(null);
  const deduper = useRef<ReturnType<typeof createFinalDeduper> | null>(null);
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
    deduper.current = null;
    if (!recognition) return;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
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

  function stop(preserveError = false) {
    session.current.active = false;
    session.current.suspended = false;
    session.current.echo = '';
    invalidate();
    clearDraft();
    if (!preserveError) updateError(null);
    setListening(false);
  }

  function passTurn(token: number) {
    const current = session.current;
    if (token !== current.generation || !current.active || current.suspended) return;
    silence.current = null;
    const echo = current.interim;
    send();
    handoff(otherSide(current.side), echo);
  }

  /** Milliseconds left before the turn passes whatever the mic is doing. */
  function turnLimitLeft(delay: number) {
    return Math.max(0, session.current.heardAt + delay + TURN_GRACE_MS - Date.now());
  }

  /**
   * Starts the pause before the turn passes. `resume` restarts it after a mic restart without
   * counting as new words, so the wall-clock limit still runs from the last words heard.
   */
  function armSilence(resume = false) {
    const current = session.current;
    const token = current.generation;
    if (silence.current !== null) clearTimeout(silence.current);
    silence.current = null;
    const delay = opts.current.switchAfterMs;
    if (
      delay === null ||
      !current.active ||
      current.suspended ||
      !(current.draft || current.interim)
    )
      return;
    if (!resume || !current.heardAt) current.heardAt = Date.now();
    silence.current = setTimeout(() => passTurn(token), Math.min(delay, turnLimitLeft(delay)));
  }

  /** Stops the pause while the mic restarts; only the wall-clock limit keeps running. */
  function holdSilenceTimer() {
    const current = session.current;
    if (silence.current === null) return false;
    clearTimeout(silence.current);
    silence.current = null;
    const delay = opts.current.switchAfterMs;
    if (delay === null) return true;
    const token = current.generation;
    silence.current = setTimeout(() => passTurn(token), turnLimitLeft(delay));
    return true;
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
    const local = wantsLocalSpeech(current.local) ? await prepareOnDeviceSpeech(locale) : false;
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
    let startedAt = Date.now();
    let lastError: string | null = null;
    let finals = new Set<number>();
    let newWords = createFinalDeduper();
    deduper.current = newWords;
    // Each start() is a new session: result indexes begin at 0 again.
    function newSession() {
      startedAt = Date.now();
      lastError = null;
      finals = new Set<number>();
      newWords = createFinalDeduper();
      deduper.current = newWords;
    }
    // The pause before the turn passes counts only while the mic can hear. Android ends a
    // session at every breath and takes a moment to listen again; counting that gap passed
    // the turn while the speaker was still talking.
    let silenceHeld = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    function holdSilence() {
      // A second end while already held keeps the original limit running
      if (silenceHeld) return;
      silenceHeld = holdSilenceTimer();
    }
    function releaseSilence() {
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = null;
      if (!silenceHeld || !valid()) return;
      silenceHeld = false;
      armSilence(true);
    }

    recognition.onstart = () => {
      if (!valid()) return;
      logSpeechNote('start');
      releaseSilence();
    };

    recognition.onresult = (event) => {
      if (!valid()) return;
      logSpeechEvent(event);
      if (isOffline()) setLocal(true); // heard while offline, so it runs on this device
      const prevDraft = current.draft;
      const prevInterim = current.interim;
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (!finals.has(index)) {
            finals.add(index);
            let { drop, add } = newWords.revise(text);
            if (current.echo && add) {
              add = stripEcho(add, current.echo);
              current.echo = '';
              drop = 0;
            }
            current.draft = appendDistinct(dropLastWords(current.draft, drop), add);
          }
        } else {
          parts.push(text);
        }
      }
      const interim = newWords.peek(mergeInterim(parts));
      current.interim = current.echo ? stripEcho(interim, current.echo) : interim;
      updateDraft(current.draft);
      updateInterim(current.interim);
      current.failures = 0;
      updateError(null);
      if (current.draft !== prevDraft || current.interim !== prevInterim) {
        // New words mean the mic is hearing again, so any hold is over
        silenceHeld = false;
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        releaseTimer = null;
        armSilence();
      }
    };

    recognition.onerror = ({ error: code }) => {
      if (!valid()) return;
      lastError = code;
      logSpeechNote(`error ${code}`);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        updateError('Microphone permission is required. You can type a message.');
        stop(true);
        opts.current.onPermissionDenied?.();
      } else if (code === 'language-not-supported') {
        updateError(`Speech recognition doesn't support ${lang} in this browser.`);
        stop(true);
        opts.current.onUnsupportedLanguage?.(lang);
      } else if (code === 'audio-capture') {
        updateError('Microphone is unavailable or in use by another app. You can type a message.');
        stop(true);
      } else if (code === 'network') {
        updateError('Reconnecting speech service…');
      }
    };

    /**
     * Restarts this same recognizer straight from its end event, as Captions does. Building a
     * new one and aborting the ended one left an Android tablet deaf for many seconds: they
     * share the system's one speech service.
     */
    function scheduleRestart() {
      if (!valid()) return;
      logSpeechNote(`end (${lastError ?? 'ok'})`);
      preserveInterim();
      holdSilence();
      current.failures = isFailedSession(lastError, Date.now() - startedAt)
        ? current.failures + 1
        : 0;
      const again = () => {
        restart.current = null;
        if (!valid()) return;
        if (wantsLocalSpeech(current.local) !== local) {
          // Went offline or back online: a new recognizer picks the right engine
          recognizer.current = null;
          deduper.current = null;
          void begin();
          return;
        }
        newSession();
        listen();
      };
      const delay = restartDelay(current.failures);
      if (delay === 0) again();
      else restart.current = setTimeout(again, delay);
    }
    function listen() {
      try {
        recognition.start();
      } catch {
        lastError = 'network';
        scheduleRestart();
        return;
      }
      // Some engines never report onstart; don't hold the turn forever
      if (silenceHeld) {
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        releaseTimer = setTimeout(releaseSilence, 1500);
      }
    }
    recognition.onend = scheduleRestart;
    listen();
  }

  /**
   * Passes the turn. When both people speak the same language the running recognizer keeps
   * listening for the next person: restarting it drops the first words of a quick reply and,
   * on Android, chimes and takes a second or more to listen again. Unfinished words already
   * sent (`echo`) still arrive later as a final; that copy is stripped instead.
   */
  function handoff(side: Side, echo = '') {
    const current = session.current;
    const { participants } = opts.current;
    if (
      recognizer.current &&
      current.active &&
      !current.suspended &&
      speechLocale(participants[side].lang) === speechLocale(participants[current.side].lang)
    ) {
      // Only the pause timer: a pending restart must still bring the mic back
      if (silence.current !== null) clearTimeout(silence.current);
      silence.current = null;
      deduper.current?.markTurnBoundary();
      current.echo = echo;
      logSpeechNote(`turn ${side} (same mic)`);
      current.side = side;
      current.failures = 0;
      updateTurn(side);
      return;
    }
    logSpeechNote(`turn ${side} (new mic)`);
    invalidate();
    session.current.echo = '';
    session.current.side = side;
    session.current.failures = 0;
    updateTurn(side);
    if (session.current.active && !session.current.suspended) void begin();
  }

  function setTurn(side: Side) {
    const echo = session.current.interim;
    send();
    handoff(side, echo);
  }

  /**
   * Moves any in-progress speech to `side` without committing or restarting a same-language
   * recognizer, so misattributed live speech can be corrected mid-sentence.
   */
  function reassignTurn(side: Side) {
    const current = session.current;
    if (!current.active || current.side === side) return;
    const { participants } = opts.current;
    if (speechLocale(participants[side].lang) === speechLocale(participants[current.side].lang)) {
      current.side = side;
      updateTurn(side);
      armSilence();
      return;
    }
    setTurn(side);
  }

  function start(local: SpeechLocality = false, side: Side = 'a') {
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
  const latestControls = useRef({ start, stop, setTurn, reassignTurn, suspend, resume });
  latestControls.current = { start, stop, setTurn, reassignTurn, suspend, resume };
  const controls = useMemo(
    () => ({
      start: (local: SpeechLocality = false, side: Side = 'a') => latestControls.current.start(local, side),
      stop: () => latestControls.current.stop(),
      setTurn: (side: Side) => latestControls.current.setTurn(side),
      reassignTurn: (side: Side) => latestControls.current.reassignTurn(side),
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
