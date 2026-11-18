import { useCallback, useEffect, useRef, useState } from 'react';
import type { LectureEntry } from '../conversation/lectureState';
import type { ConversationLanguage } from '../types';
import { piperClient, type PlaybackHandle, type SpeechClient } from './piperClient';
import { BROWSER_VOICE_ID, resolveVoiceId, type VoicePreferences } from './voices';
import {
  emptyTracker,
  finalRemainder,
  nextLiveSegment,
  splitWords,
  trackWords,
  type WordTracker,
} from './liveSegments';

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'downloading';

export interface ActivePlayback {
  entryId: string;
  lang: ConversationLanguage;
  status: Exclude<PlaybackStatus, 'idle'>;
}

/** `activePlayback.entryId` while a piece of the not-yet-finalized line is being read. */
export const LIVE_PLAYBACK_ID = 'live';

export interface LiveReadAloud {
  /** The speaker's in-progress (interim) English. */
  interim: string;
  translate: (text: string, lang: ConversationLanguage) => Promise<string>;
  /**
   * Call `onBeforePlay` (which pauses the teacher's microphone) for automatic reading too.
   * False keeps the microphone listening while it reads, which needs headphones.
   */
  suspendSpeech: boolean;
}

export interface UseLecturePlaybackOptions {
  entries: LectureEntry[];
  voicePrefs: VoicePreferences;
  readAloud: boolean;
  liveLang: ConversationLanguage;
  onBeforePlay?: () => void;
  /** Read settled words while the speaker is still talking, instead of waiting for a pause. */
  live?: LiveReadAloud | null;
  client?: SpeechClient;
}

interface LiveSlot {
  text: string | null;
  done: boolean;
}

interface LiveState {
  /** Id of the last finalized entry when this utterance began. */
  key: string;
  tracker: WordTracker;
  /** Words of the current utterance already sent to be read. */
  spoken: number;
  /** Pieces waiting to be read, in order; each fills in when its translation arrives. */
  slots: LiveSlot[];
}

const lastEntryId = (entries: LectureEntry[]) => entries[entries.length - 1]?.id ?? '';

export function getLectureCellText(entry: LectureEntry, lang: ConversationLanguage): string | null {
  const raw = lang === 'en' ? entry.english : entry.translations[lang];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

export function useLecturePlayback({
  entries,
  voicePrefs,
  readAloud,
  liveLang,
  onBeforePlay,
  live = null,
  client = piperClient,
}: UseLecturePlaybackOptions) {
  const [cursor, setCursor] = useState<{ entryId: string; lang: ConversationLanguage } | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const voicePrefsRef = useRef(voicePrefs);
  voicePrefsRef.current = voicePrefs;

  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;

  const liveLangRef = useRef(liveLang);
  liveLangRef.current = liveLang;

  const onBeforePlayRef = useRef(onBeforePlay);
  onBeforePlayRef.current = onBeforePlay;

  const liveRef = useRef(live);
  liveRef.current = live;
  const liveStateRef = useRef<LiveState>({ key: lastEntryId(entries), tracker: emptyTracker(), spoken: 0, slots: [] });
  /** Automatic reading pauses the microphone unless live reading says to keep listening. */
  const beforeAutoPlay = () => {
    if (!liveRef.current || liveRef.current.suspendSpeech) onBeforePlayRef.current?.();
  };

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const statusRef = useRef(status);
  statusRef.current = status;

  const handleRef = useRef<PlaybackHandle | null>(null);
  const generationRef = useRef(0);
  const seenLiveRef = useRef<Set<string>>(new Set());
  const prevReadAloudRef = useRef(readAloud);
  const prevLiveLangRef = useRef(liveLang);
  const startedFromLiveRef = useRef(false);

  const stopInternal = useCallback((markCurrentSeen: boolean) => {
    generationRef.current += 1;
    handleRef.current?.stop();
    handleRef.current = null;
    startedFromLiveRef.current = false;
    cursorRef.current = null;
    statusRef.current = 'idle';
    setCursor(null);
    setStatus('idle');
    setDownloadProgress(null);
    if (markCurrentSeen) {
      const lang = liveLangRef.current;
      for (const entry of entriesRef.current) {
        if (getLectureCellText(entry, lang)) {
          seenLiveRef.current.add(`${lang}:${entry.id}`);
        }
      }
    }
  }, []);

  const stop = useCallback(() => {
    stopInternal(true);
    // Don't pick the interrupted sentence back up
    const state = liveStateRef.current;
    state.spoken = Math.max(state.spoken, state.tracker.words.length);
    state.slots = [];
  }, [stopInternal]);

  const speakEntryAt = useCallback(
    (entry: LectureEntry, lang: ConversationLanguage, gen: number, fromLive = false) => {
      if (gen !== generationRef.current) return;
      const text = getLectureCellText(entry, lang);
      if (!text) return;

      const voiceId = resolveVoiceId(lang, voicePrefsRef.current);
      seenLiveRef.current.add(`${lang}:${entry.id}`);
      startedFromLiveRef.current = fromLive;
      const nextCursor = { entryId: entry.id, lang };
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
      setDownloadProgress(null);

      // Prefetch the next available segment in this column while this one plays.
      if (client.isPiperSupported() && voiceId !== BROWSER_VOICE_ID) {
        const currentEntries = entriesRef.current;
        const idx = currentEntries.findIndex((item) => item.id === entry.id);
        if (idx >= 0) {
          for (let i = idx + 1; i < currentEntries.length; i += 1) {
            const nextText = getLectureCellText(currentEntries[i], lang);
            if (nextText) {
              client.prefetch(nextText, voiceId);
              break;
            }
          }
        }
      }

      let settled = false;
      const advance = () => {
        if (settled || gen !== generationRef.current) return;
        settled = true;
        handleRef.current = null;
        const latestEntries = entriesRef.current;
        const currentIdx = latestEntries.findIndex((item) => item.id === entry.id);
        if (currentIdx >= 0) {
          for (let i = currentIdx + 1; i < latestEntries.length; i += 1) {
            const candidate = latestEntries[i];
            // Automatic reading skips lines already read aloud while they were spoken
            if (fromLive && seenLiveRef.current.has(`${lang}:${candidate.id}`)) continue;
            if (getLectureCellText(candidate, lang)) {
              speakEntryAt(candidate, lang, gen, fromLive);
              return;
            }
          }
        }
        if (fromLive && playNextLiveRef.current(gen)) return;
        // Reached the end of the current backlog.
        startedFromLiveRef.current = false;
        cursorRef.current = null;
        statusRef.current = 'idle';
        setCursor(null);
        setStatus('idle');
        setDownloadProgress(null);
      };

      if (fromLive) beforeAutoPlay();
      else onBeforePlayRef.current?.();
      statusRef.current = 'playing';
      setStatus('playing');

      const handle = client.speak(text, {
        lang,
        voiceId,
        onDownloading: (progress) => {
          if (settled || gen !== generationRef.current) return;
          statusRef.current = 'downloading';
          setStatus('downloading');
          setDownloadProgress(progress);
        },
        onStart: () => {
          if (settled || gen !== generationRef.current) return;
          statusRef.current = 'playing';
          setStatus('playing');
          setDownloadProgress(null);
        },
        onEnd: advance,
        onError: advance,
      });

      if (settled || gen !== generationRef.current) {
        handle.stop();
        return;
      }
      handleRef.current = handle;
    },
    [client],
  );

  // Speak the next translated piece of the line still being spoken, if it is ready.
  // Pieces play strictly in order: a slow translation holds back the ones after it.
  const playNextLive = (gen: number): boolean => {
    if (gen !== generationRef.current || !readAloudRef.current || !liveRef.current) return false;
    const slots = liveStateRef.current.slots;
    while (slots.length > 0 && slots[0].done && !slots[0].text) slots.shift();
    const slot = slots[0];
    if (!slot?.done || !slot.text) return false;
    slots.shift();
    const text = slot.text;
    const lang = liveLangRef.current;
    const voiceId = resolveVoiceId(lang, voicePrefsRef.current);
    const nextReady = slots[0]?.done ? slots[0].text : null;
    if (nextReady && client.isPiperSupported() && voiceId !== BROWSER_VOICE_ID) client.prefetch(nextReady, voiceId);

    startedFromLiveRef.current = true;
    const nextCursor = { entryId: LIVE_PLAYBACK_ID, lang };
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
    setDownloadProgress(null);
    let settled = false;
    const advance = () => {
      if (settled || gen !== generationRef.current) return;
      settled = true;
      handleRef.current = null;
      cursorRef.current = null;
      statusRef.current = 'idle';
      if (playNextLive(gen) || speakNextUnseen(gen)) return;
      startedFromLiveRef.current = false;
      setCursor(null);
      setStatus('idle');
      setDownloadProgress(null);
    };
    beforeAutoPlay();
    statusRef.current = 'playing';
    setStatus('playing');
    const handle = client.speak(text, {
      lang,
      voiceId,
      onDownloading: (progress) => {
        if (settled || gen !== generationRef.current) return;
        statusRef.current = 'downloading';
        setStatus('downloading');
        setDownloadProgress(progress);
      },
      onStart: () => {
        if (settled || gen !== generationRef.current) return;
        statusRef.current = 'playing';
        setStatus('playing');
        setDownloadProgress(null);
      },
      onEnd: advance,
      onError: advance,
    });
    if (settled || gen !== generationRef.current) {
      handle.stop();
      return true;
    }
    handleRef.current = handle;
    return true;
  };
  const playNextLiveRef = useRef(playNextLive);
  playNextLiveRef.current = playNextLive;

  // Automatic reading: the oldest finalized line not yet read in the live language.
  const speakNextUnseen = (gen: number): boolean => {
    if (!readAloudRef.current) return false;
    const lang = liveLangRef.current;
    for (const entry of entriesRef.current) {
      if (seenLiveRef.current.has(`${lang}:${entry.id}`)) continue;
      if (getLectureCellText(entry, lang)) {
        speakEntryAt(entry, lang, gen, true);
        return true;
      }
    }
    return false;
  };

  /** Start reading if nothing is playing: live pieces first, then any unread lines. */
  const pumpLive = () => {
    if (statusRef.current !== 'idle') return;
    const gen = generationRef.current;
    if (!playNextLive(gen)) speakNextUnseen(gen);
  };
  const pumpLiveRef = useRef(pumpLive);
  pumpLiveRef.current = pumpLive;

  // Translate a settled piece now; it plays in order once its translation arrives.
  const queueLivePiece = useCallback((english: string) => {
    const options = liveRef.current;
    if (!options || !english.trim()) return;
    const slot: LiveSlot = { text: null, done: false };
    liveStateRef.current.slots.push(slot);
    const lang = liveLangRef.current;
    const translated = lang === 'en' ? Promise.resolve(english) : options.translate(english, lang);
    translated.then(
      (text) => {
        slot.text = text.trim() || null;
        // Synthesize now, while earlier pieces are still playing
        const voiceId = resolveVoiceId(lang, voicePrefsRef.current);
        if (slot.text && client.isPiperSupported() && voiceId !== BROWSER_VOICE_ID) client.prefetch(slot.text, voiceId);
      },
      () => { slot.text = null; },
    ).finally(() => {
      slot.done = true;
      pumpLiveRef.current();
    });
  }, [client]);

  /** Start a fresh utterance; `spoken` words at its start are skipped. */
  const resetLive = useCallback((spoken: number, keepSlots: boolean) => {
    liveStateRef.current = {
      key: lastEntryId(entriesRef.current),
      tracker: emptyTracker(),
      spoken,
      slots: keepSlots ? liveStateRef.current.slots : [],
    };
  }, []);

  const togglePause = useCallback(() => {
    const currentStatus = statusRef.current;
    const handle = handleRef.current;
    if (!handle || currentStatus === 'idle' || currentStatus === 'downloading') return;
    if (currentStatus === 'playing') {
      handle.pause();
      statusRef.current = 'paused';
      setStatus('paused');
    } else if (currentStatus === 'paused') {
      client.unlockAudio();
      onBeforePlayRef.current?.();
      handle.resume();
      statusRef.current = 'playing';
      setStatus('playing');
    }
  }, [client]);

  const playFrom = useCallback(
    (entryId: string, lang: ConversationLanguage) => {
      if (
        cursorRef.current?.entryId === entryId &&
        cursorRef.current?.lang === lang &&
        (statusRef.current === 'playing' || statusRef.current === 'paused')
      ) {
        togglePause();
        return;
      }

      const target = entriesRef.current.find((entry) => entry.id === entryId);
      if (!target || !getLectureCellText(target, lang)) return;

      client.unlockAudio();
      stopInternal(false);
      const gen = generationRef.current;
      speakEntryAt(target, lang, gen, false);
    },
    [client, speakEntryAt, stopInternal, togglePause],
  );

  // Stop playback when the transcript is cleared.
  useEffect(() => {
    if (entries.length === 0) {
      seenLiveRef.current.clear();
      if (statusRef.current !== 'idle') {
        stopInternal(false);
      }
    }
  }, [entries.length, stopInternal]);

  // Handle readAloud / liveLang transitions cleanly.
  useEffect(() => {
    const wasReadAloud = prevReadAloudRef.current;
    const prevLiveLang = prevLiveLangRef.current;
    prevReadAloudRef.current = readAloud;
    prevLiveLangRef.current = liveLang;

    if (prevLiveLang !== liveLang) {
      if (statusRef.current !== 'idle') {
        stopInternal(false);
      }
    }

    if (readAloud && (!wasReadAloud || prevLiveLang !== liveLang)) {
      for (const entry of entriesRef.current) {
        if (getLectureCellText(entry, liveLang)) {
          seenLiveRef.current.add(`${liveLang}:${entry.id}`);
        }
      }
    }

    if (!readAloud && wasReadAloud && startedFromLiveRef.current) {
      stopInternal(false);
    }

    if (readAloud !== wasReadAloud || prevLiveLang !== liveLang) {
      // Start live reading with the next words, not from the middle of the current sentence
      resetLive(splitWords(liveRef.current?.interim ?? '').length, false);
    }
  }, [readAloud, liveLang, stopInternal, resetLive]);

  const liveEnabled = Boolean(live);

  // Load and warm up the reading voice as soon as reading is on, so the first words aren't
  // held back by the voice model starting up.
  const readingVoice = resolveVoiceId(liveLang, voicePrefs);
  useEffect(() => {
    if (readAloud && readingVoice !== BROWSER_VOICE_ID) client.preloadVoice(readingVoice);
  }, [readAloud, readingVoice, client]);
  // A line was finalized after part of it was already read live: read only the rest of it,
  // and don't read the whole line again.
  useEffect(() => {
    const state = liveStateRef.current;
    const lastId = lastEntryId(entries);
    if (lastId === state.key) return;
    const finalized = entries[entries.length - 1];
    if (readAloud && liveEnabled && finalized && state.spoken > 0) {
      seenLiveRef.current.add(`${liveLang}:${finalized.id}`);
      const { remainder, carry } = finalRemainder(finalized.english, state.spoken);
      resetLive(carry, true);
      queueLivePiece(remainder);
    } else {
      resetLive(0, true);
    }
  }, [entries, readAloud, liveLang, liveEnabled, resetLive, queueLivePiece]);

  // Follow the in-progress line and queue each settled piece. Settling depends on time
  // passing, so re-check a few times a second while there is unread speech.
  const liveInterim = readAloud && live ? live.interim : '';
  useEffect(() => {
    if (!liveRef.current || !readAloud) return;
    const state = liveStateRef.current;
    state.tracker = trackWords(state.tracker, liveInterim, Date.now());
    const check = () => {
      const current = liveStateRef.current;
      const segment = nextLiveSegment(current.tracker, current.spoken, Date.now());
      if (!segment) return;
      current.spoken = segment.end;
      queueLivePiece(current.tracker.words.slice(segment.start, segment.end).join(' '));
    };
    check();
    if (!liveInterim) return;
    const timer = setInterval(check, 200);
    return () => clearInterval(timer);
  }, [liveInterim, readAloud, queueLivePiece]);

  // Auto-speak newly finalized entries when readAloud ("Read live") is enabled.
  useEffect(() => {
    if (!readAloud || statusRef.current !== 'idle') return;
    speakNextUnseen(generationRef.current);
    // speakNextUnseen reads everything else it needs from refs
  }, [entries, readAloud, liveLang, speakEntryAt]);

  useEffect(() => () => {
    generationRef.current += 1;
    handleRef.current?.stop();
    handleRef.current = null;
  }, []);

  const activePlayback: ActivePlayback | null =
    cursor && status !== 'idle'
      ? { entryId: cursor.entryId, lang: cursor.lang, status }
      : null;

  return {
    activePlayback,
    status,
    downloadProgress,
    playFrom,
    togglePause,
    stop,
  };
}
