import { useSyncExternalStore } from 'react';

/**
 * Raw speech-recognition events, shown on screen when the page URL has `debugSpeech=1`.
 * For devices without a reachable console (Android tablets), so their engine's real result
 * pattern can be seen and copied.
 */
const enabled = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debugSpeech');
  } catch {
    return false;
  }
})();

let lines: string[] = [];
const listeners = new Set<() => void>();

type ResultLike = { isFinal: boolean; [index: number]: { transcript: string } | undefined };
export function logSpeechEvent(event: { resultIndex?: number; results: ArrayLike<ResultLike> }) {
  if (!enabled) return;
  const results = Array.from(event.results, (r, i) => `${i}${r.isFinal ? 'F' : '~'}"${r[0]?.transcript ?? ''}"`);
  const time = new Date().toISOString().slice(17, 23);
  lines = [...lines.slice(-79), `${time} ri=${event.resultIndex ?? '?'} ${results.join(' ')}`];
  listeners.forEach((l) => l());
}

export function logSpeechNote(note: string) {
  if (!enabled) return;
  lines = [...lines.slice(-79), `${new Date().toISOString().slice(17, 23)} -- ${note}`];
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function SpeechDebugPanel() {
  const log = useSyncExternalStore(subscribe, () => lines);
  if (!enabled) return null;
  const text = log.join('\n');
  return (
    <div className="fixed bottom-2 right-2 z-50 w-[min(95vw,40rem)] max-h-[40vh] flex flex-col rounded-lg border border-amber-400 bg-black/90 text-[11px] text-amber-200 font-mono">
      <div className="flex gap-2 p-1 border-b border-amber-400/40">
        <strong className="flex-1">Speech debug ({log.length})</strong>
        <button onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
        <button onClick={() => { lines = []; listeners.forEach((l) => l()); }}>Clear</button>
      </div>
      <pre className="overflow-auto p-1 whitespace-pre-wrap">{text || 'Waiting for speech…'}</pre>
    </div>
  );
}
