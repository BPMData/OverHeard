import type { RefObject } from 'react';
import type { SpeechRecognitionInstance } from './types';

export function recognitionConstructor() {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function createRecognition(Constructor: new () => SpeechRecognitionInstance, locale: string) {
  const recognition = new Constructor();
  recognition.lang = locale;
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

export function detachRecognition(ref: RefObject<SpeechRecognitionInstance | null>) {
  const recognition = ref.current;
  ref.current = null;
  if (!recognition) return;
  // Some engines fire error/end during abort. A retired mic must never restart itself.
  recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
  try {
    recognition.abort();
  } catch {
    // The browser may already have ended this session.
  }
}
