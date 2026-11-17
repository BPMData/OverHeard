import { useCallback, useEffect, useRef, useState } from 'react';
import type { LectureEntry } from '../conversation/lectureState';
import type { ConversationLanguage } from '../types';
import { piperClient, type PlaybackHandle, type SpeechClient } from './piperClient';
import { BROWSER_VOICE_ID, resolveVoiceId, type VoicePreferences } from './voices';

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'downloading';

export interface ActivePlayback {
  entryId: string;
  lang: ConversationLanguage;
  status: Exclude<PlaybackStatus, 'idle'>;
}

export interface UseLecturePlaybackOptions {
  entries: LectureEntry[];
  voicePrefs: VoicePreferences;
  readAloud: boolean;
  liveLang: ConversationLanguage;
  onBeforePlay?: () => void;
  client?: SpeechClient;
}

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
            if (getLectureCellText(candidate, lang)) {
              speakEntryAt(candidate, lang, gen, fromLive);
              return;
            }
          }
        }
        // Reached the end of the current backlog.
        startedFromLiveRef.current = false;
        cursorRef.current = null;
        statusRef.current = 'idle';
        setCursor(null);
        setStatus('idle');
        setDownloadProgress(null);
      };

      onBeforePlayRef.current?.();
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
  }, [readAloud, liveLang, stopInternal]);

  // Auto-speak newly finalized entries when readAloud ("Read live") is enabled.
  useEffect(() => {
    if (!readAloud || statusRef.current !== 'idle') return;
    for (const entry of entries) {
      const key = `${liveLang}:${entry.id}`;
      if (seenLiveRef.current.has(key)) continue;
      if (getLectureCellText(entry, liveLang)) {
        const gen = generationRef.current;
        speakEntryAt(entry, liveLang, gen, true);
        return;
      }
    }
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

export interface TwoWaySpeechItem {
  id: string;
  text: string;
  lang: ConversationLanguage;
}

export interface UseTwoWayPlaybackOptions {
  voicePrefs: VoicePreferences;
  onSuspendSpeech: () => void;
  onResumeSpeech: () => void;
  client?: SpeechClient;
}

interface QueuedPiperItem extends TwoWaySpeechItem {
  voiceId: string;
}

export function useTwoWayPlayback({
  voicePrefs,
  onSuspendSpeech,
  onResumeSpeech,
  client = piperClient,
}: UseTwoWayPlaybackOptions) {
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [downloadingMessageId, setDownloadingMessageId] = useState<string | null>(null);
  const playingIdRef = useRef<string | null>(null);
  playingIdRef.current = playingMessageId;

  const voicePrefsRef = useRef(voicePrefs);
  voicePrefsRef.current = voicePrefs;

  const onSuspendRef = useRef(onSuspendSpeech);
  onSuspendRef.current = onSuspendSpeech;

  const onResumeRef = useRef(onResumeSpeech);
  onResumeRef.current = onResumeSpeech;

  const generationRef = useRef(0);
  const activePiperRef = useRef<PlaybackHandle | null>(null);
  const piperQueueRef = useRef<QueuedPiperItem[]>([]);
  const browserHandlesRef = useRef<Set<PlaybackHandle>>(new Set());

  const maybeResumeSpeech = useCallback(() => {
    if (
      activePiperRef.current === null &&
      piperQueueRef.current.length === 0 &&
      browserHandlesRef.current.size === 0 &&
      !window.speechSynthesis?.pending &&
      !window.speechSynthesis?.speaking
    ) {
      playingIdRef.current = null;
      setPlayingMessageId(null);
      setDownloadingMessageId(null);
      onResumeRef.current();
    }
  }, []);

  const cancelAll = useCallback(() => {
    generationRef.current += 1;
    activePiperRef.current?.stop();
    activePiperRef.current = null;
    piperQueueRef.current = [];
    for (const handle of browserHandlesRef.current) {
      handle.stop();
    }
    browserHandlesRef.current.clear();
    window.speechSynthesis?.cancel();
    playingIdRef.current = null;
    setPlayingMessageId(null);
    setDownloadingMessageId(null);
  }, []);

  const startPiperItem = useCallback(
    (item: QueuedPiperItem, gen: number) => {
      if (gen !== generationRef.current) return;
      playingIdRef.current = item.id;
      setPlayingMessageId(item.id);
      setDownloadingMessageId(null);

      const nextQueued = piperQueueRef.current[0];
      if (nextQueued) {
        client.prefetch(nextQueued.text, nextQueued.voiceId);
      }

      let settled = false;
      const onFinish = () => {
        if (settled || gen !== generationRef.current) return;
        settled = true;
        activePiperRef.current = null;
        setDownloadingMessageId((cur) => (cur === item.id ? null : cur));
        const next = piperQueueRef.current.shift();
        if (next) {
          startPiperItem(next, gen);
          return;
        }
        maybeResumeSpeech();
      };

      const handle = client.speak(item.text, {
        lang: item.lang,
        voiceId: item.voiceId,
        onDownloading: () => {
          if (!settled && gen === generationRef.current) {
            setDownloadingMessageId(item.id);
          }
        },
        onStart: () => {
          if (!settled && gen === generationRef.current) {
            setDownloadingMessageId((cur) => (cur === item.id ? null : cur));
          }
        },
        onEnd: onFinish,
        onError: onFinish,
      });

      if (!settled && gen === generationRef.current) {
        activePiperRef.current = handle;
      } else if (gen !== generationRef.current) {
        handle.stop();
      }
    },
    [client, maybeResumeSpeech],
  );

  const startBrowserItem = useCallback(
    (item: TwoWaySpeechItem, voiceId: string, gen: number, trackAsActive: boolean) => {
      if (gen !== generationRef.current) return;
      if (trackAsActive) {
        playingIdRef.current = item.id;
        setPlayingMessageId(item.id);
      }
      let settled = false;
      let handleRef: PlaybackHandle | null = null;
      const onFinish = () => {
        if (settled || gen !== generationRef.current) return;
        settled = true;
        if (handleRef) browserHandlesRef.current.delete(handleRef);
        maybeResumeSpeech();
      };
      const handle = client.speak(item.text, {
        lang: item.lang,
        voiceId,
        onEnd: onFinish,
        onError: onFinish,
      });
      handleRef = handle;
      if (!settled && gen === generationRef.current) {
        browserHandlesRef.current.add(handle);
      } else if (gen !== generationRef.current) {
        handle.stop();
      }
    },
    [client, maybeResumeSpeech],
  );

  const enqueueAuto = useCallback(
    (items: TwoWaySpeechItem[]) => {
      if (items.length === 0) return;
      client.unlockAudio();
      onSuspendRef.current();
      const gen = generationRef.current;

      for (const item of items) {
        const voiceId = resolveVoiceId(item.lang, voicePrefsRef.current);
        if (client.shouldUsePiper(item.lang, voiceId)) {
          const queued: QueuedPiperItem = { ...item, voiceId };
          if (activePiperRef.current) {
            piperQueueRef.current.push(queued);
            if (piperQueueRef.current.length === 1) {
              client.prefetch(queued.text, queued.voiceId);
            }
          } else {
            startPiperItem(queued, gen);
          }
        } else {
          startBrowserItem(item, voiceId, gen, false);
        }
      }
    },
    [client, startBrowserItem, startPiperItem],
  );

  const togglePlayMessage = useCallback(
    (item: TwoWaySpeechItem) => {
      if (playingIdRef.current === item.id) {
        cancelAll();
        onResumeRef.current();
        return;
      }

      cancelAll();
      client.unlockAudio();
      onSuspendRef.current();
      const gen = generationRef.current;
      const voiceId = resolveVoiceId(item.lang, voicePrefsRef.current);
      if (client.shouldUsePiper(item.lang, voiceId)) {
        startPiperItem({ ...item, voiceId }, gen);
      } else {
        startBrowserItem(item, voiceId, gen, true);
      }
    },
    [cancelAll, client, startBrowserItem, startPiperItem],
  );

  useEffect(() => () => {
    generationRef.current += 1;
    activePiperRef.current?.stop();
    activePiperRef.current = null;
    piperQueueRef.current = [];
    for (const handle of browserHandlesRef.current) {
      handle.stop();
    }
    browserHandlesRef.current.clear();
  }, []);

  return {
    playingMessageId,
    downloadingMessageId,
    enqueueAuto,
    togglePlayMessage,
    cancelAll,
  };
}
