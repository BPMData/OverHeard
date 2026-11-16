import { useEffect, useState } from 'react';
import { applyPatch, type RoomSnapshot } from './protocol';

export function useStudentRoom(code: string) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('Connecting to your teacher…');
  useEffect(() => {
    let disposed = false;
    const events = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events`);
    const accept = () => { setConnected(true); setError(''); };
    events.addEventListener('snapshot', event => {
      if (disposed) return;
      try { setSnapshot(JSON.parse((event as MessageEvent).data)); accept(); }
      catch { setError('Could not read the lecture stream. Rejoin the room.'); }
    });
    events.addEventListener('patch', event => {
      if (disposed) return;
      try {
        const patch = JSON.parse((event as MessageEvent).data);
        setSnapshot(previous => previous && patch.revision > previous.revision
          ? { ...applyPatch(previous, patch), revision: patch.revision, teacherOnline: true, ended: false } : previous);
        accept();
      } catch { setError('Could not read the lecture update. Rejoin the room.'); }
    });
    events.addEventListener('expired', () => {
      events.close(); setConnected(false); setError('This room has expired. Ask your teacher for a new link.');
    });
    events.onerror = () => {
      if (disposed) return;
      setConnected(false); setError('Connection lost. Reconnecting…');
      void fetch(`/api/rooms/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(10_000) }).then(async response => {
        if (!disposed && response.status === 404) {
          events.close(); const data = await response.json(); if (!disposed) setError(data.error);
        }
      }).catch(() => { /* EventSource will reconnect and receive a fresh snapshot. */ });
    };
    return () => { disposed = true; events.close(); };
  }, [code]);
  return { snapshot, connected, error };
}
