import { createRecognition, detachRecognition, recognitionConstructor } from '../speech/recognition';
import type { SpeechRecognitionInstance } from '../speech/types';
import { appendDistinct, createFinalDeduper, dropLastWords, mergeInterim, stripEcho } from '../speechDedupe';
import { logSpeechEvent, logSpeechNote } from '../speechDebug';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareOnDeviceSpeech } from '../onDevice';
import { isFailedSession, restartDelay } from '../speechRestart';
import { speechLocale } from './locales';
import { isOffline, wantsLocalSpeech, type SpeechLocality } from '../offline';
import { otherSide, type Side } from './state';

/** How long a turn change waits for the ended session's end event before replacing the mic. */
const BOUNDARY_TIMEOUT_MS = 1500;

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
    local: false as SpeechLocality,
    /**
     * Unfinished words already sent with the previous turn. The shared recognizer will still
     * deliver them as a final, which must not open the next person's message.
     */
    echo: '',
    /** The whole message sent with that unfinished tail; a new session may repeat all of it. */
    echoSent: '',
    /**
     * The turn just passed and the running session is being ended so the next person starts
     * a fresh one. Results until it ends belong to words already sent and are ignored.
     */
    boundary: false,
    // Chrome already ended the session containing the speaker’s finalized words.
    freshAfterFinal: false,
  });
  const recognizer = useRef<SpeechRecognitionInstance | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boundaryGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (silence.current !== null) clearTimeout(silence.current);
    if (restart.current !== null) clearTimeout(restart.current);
    if (boundaryGuard.current !== null) clearTimeout(boundaryGuard.current);
    silence.current = restart.current = boundaryGuard.current = null;
  }

  /** `text` without the previous turn's unfinished words, or all of it, repeated at its start. */
  function withoutEcho(text: string) {
    const { echo, echoSent } = session.current;
    if (!echo) return text;
    const whole = stripEcho(text, echoSent);
    return whole !== stripEcho(text, '') ? whole : stripEcho(text, echo);
  }

  function invalidate() {
    session.current.generation++;
    session.current.boundary = false;
    session.current.freshAfterFinal = false;
    clearTimers();
    detachRecognition(recognizer);
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
    return text;
  }

  function stop(preserveError = false) {
    session.current.active = false;
    session.current.suspended = false;
    session.current.echo = session.current.echoSent = '';
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
    const sent = send();
    handoff(otherSide(current.side), echo, sent, 'pause');
  }

  /**
   * Starts the pause before the turn passes, counted from the last new words. Mic restarts
   * don't move it: an Android tablet ends and restarts its session about every second in a
   * quiet room, and holding the pause through each restart meant Auto never passed the turn.
   */
  function armSilence() {
    const current = session.current;
    const token = current.generation;
    if (silence.current !== null) clearTimeout(silence.current);
    silence.current = null;
    const delay = opts.current.switchAfterMs;
    if (delay === null || !current.active || current.suspended || !(current.draft || current.interim)) return;
    silence.current = setTimeout(() => passTurn(token), delay);
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
    const recognition = createRecognition(Constructor, locale);
    recognizer.current = recognition;
    recognition.processLocally = local;
    const valid = () =>
      token === current.generation && current.active && !current.suspended && recognizer.current === recognition;
    let startedAt = Date.now();
    let lastError: string | null = null;
    let finals = new Set<number>();
    let newWords = createFinalDeduper();
    // Each start() is a new session: result indexes begin at 0 again.
    function newSession() {
      startedAt = Date.now();
      lastError = null;
      finals = new Set<number>();
      newWords = createFinalDeduper();
    }
    recognition.onstart = () => {
      if (!valid()) return;
      logSpeechNote('start');
    };

    recognition.onresult = (event) => {
      if (!valid() || current.boundary) return;
      current.freshAfterFinal = false;
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
            if (current.echo) {
              // Chrome can finalize the same old words more than once, first as a
              // fragment and then as a revision. Compare the whole browser result
              // until we see the next speaker's words. Keep the deduper's raw history
              // so a later cumulative extension contributes only its new tail.
              add = withoutEcho(text);
              drop = 0;
              if (add) current.echo = current.echoSent = '';
            }
            current.draft = appendDistinct(dropLastWords(current.draft, drop), add);
          }
        } else {
          parts.push(text);
        }
      }
      const interim = mergeInterim(parts);
      current.interim = current.echo ? withoutEcho(interim) : newWords.peek(interim);
      updateDraft(current.draft);
      updateInterim(current.interim);
      current.failures = 0;
      updateError(null);
      if (current.draft !== prevDraft || current.interim !== prevInterim) armSilence();
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
      const endedAfterFinal =
        !current.boundary && lastError === null && !current.interim && (current.freshAfterFinal || finals.size > 0);
      current.freshAfterFinal = false;
      if (current.boundary) {
        // Ended on purpose at a turn change: start the next person's session right away
        current.boundary = false;
        if (boundaryGuard.current !== null) clearTimeout(boundaryGuard.current);
        boundaryGuard.current = null;
        current.interim = '';
        updateInterim('');
        current.failures = 0;
      } else {
        preserveInterim();
        current.failures = isFailedSession(lastError, Date.now() - startedAt) ? current.failures + 1 : 0;
      }
      const again = () => {
        restart.current = null;
        if (!valid()) return;
        if (wantsLocalSpeech(current.local) !== local) {
          // Went offline or back online: a new recognizer picks the right engine
          recognizer.current = null;
          void begin();
          return;
        }
        current.freshAfterFinal = endedAfterFinal && Boolean(current.draft);
        newSession();
        listen();
      };
      const delay = restartDelay(current.failures);
      if (delay === 0) again();
      else restart.current = setTimeout(again, delay);
    }
    function listen() {
      try {
        logSpeechNote('request start');
        recognition.start();
      } catch {
        lastError = 'network';
        scheduleRestart();
        return;
      }
    }
    recognition.onend = scheduleRestart;
    listen();
  }

  /**
   * Same-language turns reuse the recognizer. Each speaker gets fresh result indexes
   * because Chrome can revise and resend words from a running session. If Chrome has
   * already restarted since the final words, Auto can use that fresh session directly.
   */
  function handoff(side: Side, echo = '', sent = '', trigger: 'tap' | 'pause' = 'tap') {
    const current = session.current;
    const { participants } = opts.current;
    const recognition = recognizer.current;
    if (
      recognition &&
      current.active &&
      !current.suspended &&
      speechLocale(participants[side].lang) === speechLocale(participants[current.side].lang)
    ) {
      // Only the pause timer: a pending restart must still bring the mic back
      if (silence.current !== null) clearTimeout(silence.current);
      silence.current = null;
      current.echo = echo;
      current.echoSent = echo ? sent : '';
      current.side = side;
      current.failures = 0;
      updateTurn(side);
      // If Chrome already restarted after the last final, Auto can hand this empty
      // session to the next speaker. Aborting it again loses the start of their reply.
      const reuseFreshSession = trigger === 'pause' && current.freshAfterFinal;
      current.freshAfterFinal = false;
      if (reuseFreshSession) {
        logSpeechNote(`turn ${side} (browser already restarted after final)`);
        return;
      }
      if (restart.current !== null || current.boundary) {
        logSpeechNote(`turn ${side} (session already restarting)`);
        return;
      }
      logSpeechNote(`turn ${side} (same mic, new session)`);
      current.boundary = true;
      const token = current.generation;
      // If the engine never reports the end, fall back to a new recognizer
      boundaryGuard.current = setTimeout(() => {
        boundaryGuard.current = null;
        if (token !== current.generation || !current.boundary) return;
        logSpeechNote('turn session did not end; new mic');
        invalidate();
        if (current.active && !current.suspended) void begin();
      }, BOUNDARY_TIMEOUT_MS);
      try {
        recognition.abort();
      } catch {
        // Already ended: its end event restarts it
      }
      return;
    }
    logSpeechNote(`turn ${side} (new mic)`);
    invalidate();
    session.current.echo = session.current.echoSent = '';
    session.current.side = side;
    session.current.failures = 0;
    updateTurn(side);
    if (session.current.active && !session.current.suspended) void begin();
  }

  function setTurn(side: Side) {
    const echo = session.current.interim;
    const sent = send();
    handoff(side, echo, sent);
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
    []
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
    []
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
