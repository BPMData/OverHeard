import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationLanguage } from '../types';
import { piperClient, type PlaybackHandle, type SpeechClient } from './piperClient';
import { resolveVoiceId, type VoicePreferences } from './voices';

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
    [client, maybeResumeSpeech]
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
    [client, maybeResumeSpeech]
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
    [client, startBrowserItem, startPiperItem]
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
    [cancelAll, client, startBrowserItem, startPiperItem]
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      activePiperRef.current?.stop();
      activePiperRef.current = null;
      piperQueueRef.current = [];
      for (const handle of browserHandlesRef.current) {
        handle.stop();
      }
      browserHandlesRef.current.clear();
    },
    []
  );

  return {
    playingMessageId,
    downloadingMessageId,
    enqueueAuto,
    togglePlayMessage,
    cancelAll,
  };
}
