import { useCallback, useEffect, useRef, useState } from 'react';
import { piperClient, type PlaybackHandle } from '../tts/piperClient';
import { resolveVoiceId, useVoicePreferences } from '../tts/voices';
import type { DisplayMode, LanguageCode } from '../types';

export function useColumnPlayback(displayMode: DisplayMode) {
  const [voicePrefs] = useVoicePreferences();
  const [columnPlayback, setColumnPlayback] = useState<{
    code: LanguageCode;
    status: 'downloading' | 'playing';
  } | null>(null);
  const columnPlayHandleRef = useRef<PlaybackHandle | null>(null);
  const columnPlayGenRef = useRef(0);

  const stopColumnPlayback = useCallback(() => {
    columnPlayGenRef.current += 1;
    columnPlayHandleRef.current?.stop();
    columnPlayHandleRef.current = null;
    setColumnPlayback(null);
  }, []);

  const speakColumnTranslation = useCallback(
    (code: LanguageCode, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stopColumnPlayback();
      const gen = columnPlayGenRef.current;
      const voiceId = resolveVoiceId(code, voicePrefs);
      piperClient.unlockAudio();
      let settled = false;
      setColumnPlayback({ code, status: 'playing' });
      const handle = piperClient.speak(trimmed, {
        lang: code,
        voiceId,
        onDownloading: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          setColumnPlayback({ code, status: 'downloading' });
        },
        onStart: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          setColumnPlayback({ code, status: 'playing' });
        },
        onEnd: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          settled = true;
          columnPlayHandleRef.current = null;
          setColumnPlayback(null);
        },
        onError: () => {
          if (settled || gen !== columnPlayGenRef.current) return;
          settled = true;
          columnPlayHandleRef.current = null;
          setColumnPlayback(null);
        },
      });
      if (!settled && gen === columnPlayGenRef.current) {
        columnPlayHandleRef.current = handle;
      } else if (gen !== columnPlayGenRef.current) {
        handle.stop();
      }
    },
    [stopColumnPlayback, voicePrefs],
  );

  useEffect(() => {
    if (displayMode !== 'columns') stopColumnPlayback();
  }, [displayMode, stopColumnPlayback]);

  useEffect(() => () => stopColumnPlayback(), [stopColumnPlayback]);

  return { columnPlayback, speakColumnTranslation, stopColumnPlayback };
}
