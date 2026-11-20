import { useEffect, useMemo, useRef, useState } from 'react';
import type { MicBlock } from '../micPermission';
import { prepareOnDeviceSpeech } from '../onDevice';
import { wantsLocalSpeech, type SpeechLocality } from '../offline';
import { logSpeechEvent, logSpeechNote } from '../speechDebug';
import { createFinalDeduper } from '../speechDedupe';
import { isFailedSession, restartDelay } from '../speechRestart';

interface ResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionConstructor() {
  const globals = globalThis as unknown as {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  };
  return globals.SpeechRecognition ?? globals.webkitSpeechRecognition;
}

export interface LectureSpeechOptions {
  onFinal: (text: string) => void;
  onPermissionDenied?: (reason?: MicBlock) => void;
}

/**
 * Continuous single-speaker English (en-US) speech recognition hook for Lecture mode.
 * Never hands off turns; streams interim text live and emits finalized utterances immediately.
 */
export function useLectureSpeech(options: LectureSpeechOptions) {
  const opts = useRef(options);
  opts.current = options;

  const [isListening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speechLocal, setLocal] = useState<boolean | null>(null);

  const session = useRef({
    active: false,
    suspended: false,
    local: false as SpeechLocality,
    generation: 0,
    failures: 0,
    startedAt: 0,
    lastError: null as string | null,
    interim: '',
  });
  const recognizer = useRef<Recognizer | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deduperRef = useRef(createFinalDeduper());

  function clearTimer() {
    if (restartTimer.current !== null) {
      clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  }

  function detach() {
    const rec = recognizer.current;
    recognizer.current = null;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      // Already ended
    }
  }

  function stop() {
    session.current.active = false;
    session.current.suspended = false;
    session.current.generation++;
    session.current.interim = '';
    clearTimer();
    detach();
    setInterim('');
    setListening(false);
  }

  function suspend() {
    if (!session.current.active || session.current.suspended) return;
    session.current.suspended = true;
    session.current.generation++;
    session.current.interim = '';
    clearTimer();
    detach();
    setInterim('');
  }

  function resume() {
    if (!session.current.suspended) return;
    session.current.suspended = false;
    if (session.current.active) void begin();
  }

  async function begin() {
    const current = session.current;
    const token = current.generation;
    if (!current.active || current.suspended) return;

    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError('Speech recognition is unavailable in this browser. You can type a line below.');
      stop();
      return;
    }

    const local = wantsLocalSpeech(current.local) ? await prepareOnDeviceSpeech('en-US') : false;
    if (token !== current.generation || !current.active || current.suspended) return;
    setLocal(local);

    const rec = new Constructor();
    recognizer.current = rec;
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = local;
    deduperRef.current = createFinalDeduper();

    const valid = () =>
      token === current.generation &&
      current.active &&
      !current.suspended &&
      recognizer.current === rec;

    rec.onstart = () => {
      if (!valid()) return;
      deduperRef.current = createFinalDeduper();
      current.startedAt = Date.now();
      current.lastError = null;
      setListening(true);
    };

    rec.onresult = (event) => {
      if (!valid()) return;
      logSpeechEvent(event);
      current.failures = 0;
      setError(null);
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) {
          current.interim = '';
          setInterim('');
          const fresh = deduperRef.current(transcript);
          if (fresh) opts.current.onFinal(fresh);
        } else {
          live += transcript;
        }
      }
      current.interim = live;
      setInterim(live);
    };

    rec.onerror = ({ error: code }) => {
      if (!valid()) return;
      current.lastError = code;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Microphone permission is required. You can type a line below.');
        stop();
        opts.current.onPermissionDenied?.('denied');
      } else if (code === 'network') {
        setError('Reconnecting speech service…');
      }
    };

    const scheduleRestart = () => {
      if (!valid()) return;
      logSpeechNote(`lecture end (${current.lastError ?? 'ok'})`);
      // Preserve any trailing unfinalized clause if Chrome ended the session cleanly on silence
      const leftover = current.interim.trim();
      if (leftover && current.lastError === null) {
        const fresh = deduperRef.current(leftover);
        if (fresh) opts.current.onFinal(fresh);
      }
      current.interim = '';
      setInterim('');
      detach();

      current.failures = isFailedSession(current.lastError, Date.now() - current.startedAt)
        ? current.failures + 1
        : 0;

      const delay = restartDelay(current.failures);
      if (delay === 0) {
        void begin();
      } else {
        if (current.failures >= 3) {
          setError('Speech service unavailable — retrying…');
        }
        restartTimer.current = setTimeout(() => {
          restartTimer.current = null;
          if (token === current.generation && current.active && !current.suspended) void begin();
        }, delay);
      }
    };

    rec.onend = scheduleRestart;

    try {
      rec.start();
    } catch {
      current.lastError = 'network';
      scheduleRestart();
    }
  }

  function start(local: SpeechLocality = false) {
    stop();
    session.current.active = true;
    session.current.local = local;
    session.current.failures = 0;
    session.current.lastError = null;
    session.current.startedAt = Date.now();
    setError(null);
    setListening(true);
    void begin();
  }

  useEffect(() => () => stop(), []);

  const latest = useRef({ start, stop, suspend, resume });
  latest.current = { start, stop, suspend, resume };
  const controls = useMemo(
    () => ({
      start: (local: SpeechLocality = false) => latest.current.start(local),
      stop: () => latest.current.stop(),
      suspend: () => latest.current.suspend(),
      resume: () => latest.current.resume(),
    }),
    [],
  );

  return {
    isListening,
    interim,
    error,
    speechLocal,
    supported: Boolean(recognitionConstructor()),
    ...controls,
  };
}
