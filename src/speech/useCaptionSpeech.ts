import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createFinalDeduper } from '../speechDedupe';
import { logSpeechEvent } from '../speechDebug';
import { withMicAccess } from '../micPermission';
import { isFailedSession, restartDelay } from '../speechRestart';
import {
  isOnDeviceTranslationSupported,
  prepareOfflineSpeechIfTranslatorsReady,
  prepareOnDeviceSpeech,
  prepareOnDeviceTranslators,
} from '../onDevice';
import type { MtPreference } from '../app/settings';
import { isOffline, speechLocality, wantsLocalSpeech } from '../offline';
import type { LanguageCode } from '../types';
import type { SpeechRecognitionErrorEvent, SpeechRecognitionEvent, SpeechRecognitionInstance } from './types';

interface CaptionSpeechOptions {
  onFinal: (phrase: string) => void;
  onInterim: (text: string) => void;
  clearLiveTranslation: () => void;
  onPermissionChange: (denied: boolean) => void;
  setMicInsecure: (insecure: boolean) => void;
  setHasSpeechApi: (available: boolean) => void;
  mtPreferenceRef: RefObject<MtPreference>;
  selectedLangsRef: RefObject<LanguageCode[]>;
  reportPack: (key: string, fraction: number | null) => void;
}

export function useCaptionSpeech({
  onFinal, onInterim, clearLiveTranslation, onPermissionChange, setMicInsecure,
  setHasSpeechApi, mtPreferenceRef, selectedLangsRef, reportPack,
}: CaptionSpeechOptions) {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechStatusNotice, setSpeechStatusNotice] = useState<string | null>(null);
  // Whether speech recognition is running on this device (null = not started yet)
  const [speechIsLocal, setSpeechIsLocal] = useState<boolean | null>(null);
  // Refs for synchronous access in event callbacks & concurrency tracking
  const userStoppedRef = useRef<boolean>(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Keep-alive backoff: only failed sessions (network errors, instant ends) slow restarts down
  const restartTimerRef = useRef<number | null>(null);
  const restartFailuresRef = useRef<number>(0);
  const sessionStartedAtRef = useRef<number>(0);
  const lastSpeechErrorRef = useRef<string | null>(null);

  // Start / Stop Web Speech API with Chrome Keep-Alive Loop
  const startListening = useCallback(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setHasSpeechApi(false);
      return;
    }

    onPermissionChange(false);
    setSpeechStatusNotice(null);
    userStoppedRef.current = false;
    restartFailuresRef.current = 0;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      let newWords = createFinalDeduper();

      recognition.onstart = () => {
        newWords = createFinalDeduper();
        sessionStartedAtRef.current = Date.now();
        lastSpeechErrorRef.current = null;
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        logSpeechEvent(event);
        // Hearing speech means the service is healthy again
        restartFailuresRef.current = 0;
        setSpeechStatusNotice(null);
        // Heard while offline: it can only be running on this device, whatever Chrome's
        // availability check said (Android's system recognizer works offline on its own)
        if (isOffline()) setSpeechIsLocal(true);
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcriptText = result[0]?.transcript || '';
          if (result.isFinal) {
            onInterim('');
            clearLiveTranslation();
            const fresh = newWords(transcriptText);
            if (fresh) onFinal(fresh);
          } else {
            interim += transcriptText;
          }
        }
        onInterim(interim);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const errCode = event.error;
        lastSpeechErrorRef.current = errCode;
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          userStoppedRef.current = true;
          setIsListening(false);
          onInterim('');
          onPermissionChange(true);
          return;
        }

        // On 'no-speech', 'network', or 'aborted' errors, keep restarting via onend keep-alive
        if (
          errCode === 'no-speech' ||
          errCode === 'network' ||
          errCode === 'aborted'
        ) {
          if (errCode === 'network') {
            setSpeechStatusNotice('Reconnecting speech service…');
          }
          return;
        }
      };

      recognition.onend = () => {
        // Keep-alive: Chrome stops recognition after silence. If user has not pressed Stop, call start() again.
        // Normal ends restart immediately; repeated failures (e.g. offline) back off up to 5 s.
        if (!userStoppedRef.current) {
          const sessionMs = Date.now() - sessionStartedAtRef.current;
          if (isFailedSession(lastSpeechErrorRef.current, sessionMs)) {
            restartFailuresRef.current += 1;
          } else {
            restartFailuresRef.current = 0;
          }
          const restart = () => {
            restartTimerRef.current = null;
            if (userStoppedRef.current) return;
            const startNow = () => {
              if (userStoppedRef.current) return;
              try {
                recognition.start();
              } catch {
                // Ignore InvalidStateError when already running
              }
            };
            // Auto: run speech on this device while offline, and go back to Google's
            // service once the network returns. 'On this device' never changes here.
            if (mtPreferenceRef.current !== 'auto') return startNow();
            const wantLocal = isOffline();
            if (wantLocal === Boolean(recognition.processLocally)) return startNow();
            if (!wantLocal) {
              recognition.processLocally = false;
              setSpeechIsLocal(false);
              setSpeechStatusNotice(null);
              return startNow();
            }
            void prepareOnDeviceSpeech('en-US').then((local) => {
              recognition.processLocally = local;
              setSpeechIsLocal(local);
              setSpeechStatusNotice(
                local ? null : 'Offline, and on-device speech isn’t installed on this device.'
              );
              startNow();
            });
          };
          const delay = restartDelay(restartFailuresRef.current);
          if (delay === 0) {
            restart();
          } else {
            if (restartFailuresRef.current >= 3) {
              setSpeechStatusNotice('Speech service unavailable — retrying…');
            }
            restartTimerRef.current = window.setTimeout(restart, delay);
          }
        } else {
          setIsListening(false);
          onInterim('');
        }
      };

      recognitionRef.current = recognition;
    }

    const recognition = recognitionRef.current;
    const begin = (local: boolean) => {
      if (userStoppedRef.current) return; // Stop was pressed while the speech pack downloaded
      recognition.processLocally = local;
      setSpeechIsLocal(local);
      try {
        recognition.start();
      } catch {
        // Ignore InvalidStateError if already running
      }
      setIsListening(true);
    };

    if (wantsLocalSpeech(speechLocality(mtPreferenceRef.current))) {
      // 'On this device', or Auto while offline. Both downloads need a click, and this runs
      // inside the Start click.
      prepareOnDeviceTranslators(selectedLangsRef.current, reportPack);
      setIsListening(true);
      void prepareOnDeviceSpeech('en-US', () => reportPack('speech', -1)).then((local) => {
        reportPack('speech', null);
        setSpeechStatusNotice(
          local
            ? null
            : isOffline()
              ? 'Offline, and on-device speech isn’t installed on this device.'
              : 'On-device speech not available here — using Google’s speech service.'
        );
        begin(local);
      });
    } else {
      // Auto: fetch the translation packs now (this click is the gesture Chrome requires) so
      // on-device translation takes over as soon as they're ready. Captions keep flowing
      // through the online translators in the meantime. Speech stays on Google's free
      // service while online; its pack is fetched too so it can take over when offline.
      if (mtPreferenceRef.current === 'auto') {
        if (isOnDeviceTranslationSupported()) {
          prepareOnDeviceTranslators(selectedLangsRef.current, reportPack);
        }
        prepareOfflineSpeechIfTranslatorsReady(
          isOnDeviceTranslationSupported()
            ? selectedLangsRef.current.map((code) => ({ code, source: 'en' }))
            : [],
          [{ key: 'speech', locale: 'en-US' }],
          reportPack
        );
      }
      begin(false);
    }
  }, [onFinal, clearLiveTranslation, reportPack, mtPreferenceRef, selectedLangsRef, setHasSpeechApi, onInterim, onPermissionChange]);

  const stopListening = useCallback(() => {
    userStoppedRef.current = true;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
    onInterim('');
    clearLiveTranslation();
    setSpeechStatusNotice(null);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }, [clearLiveTranslation, onInterim]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      withMicAccess(startListening, (reason) => {
        setMicInsecure(reason === 'insecure');
        onPermissionChange(true);
      });
    }
  }, [isListening, startListening, stopListening, setMicInsecure, onPermissionChange]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      userStoppedRef.current = true;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  return { isListening, speechIsLocal, speechStatusNotice, startListening, stopListening, toggleListening };
}
