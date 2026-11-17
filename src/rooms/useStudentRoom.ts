import { useEffect, useState } from 'react';
import { applyPatch, type RoomSnapshot } from './protocol';

/** How often a student page checks whether the teacher has opened the room. */
export const ROOM_WAIT_POLL_MS = 4000;

export function useStudentRoom(code: string) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('Connecting to your teacher…');
  // Bumped to open a fresh event stream once the room exists again
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const path = `/api/rooms/${encodeURIComponent(code)}`;
    const events = new EventSource(`${path}/events`);
    const accept = () => { setConnected(true); setWaiting(false); setError(''); };

    // The room is not open yet (the student link was posted ahead of class) or it expired and
    // the teacher may reopen the same code: keep checking with a cheap status request.
    const waitForTeacher = () => {
      events.close();
      setConnected(false);
      setWaiting(true);
      setError(`Waiting for your teacher to start room ${code}…`);
      const poll = () => {
        pollTimer = setTimeout(() => {
          void fetch(path, { cache: 'no-store' }).then(
            response => { if (!disposed) { if (response.ok) setAttempt(value => value + 1); else poll(); } },
            () => { if (!disposed) poll(); },
          );
        }, ROOM_WAIT_POLL_MS);
      };
      poll();
    };

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
    events.addEventListener('expired', () => { if (!disposed) waitForTeacher(); });
    events.onerror = () => {
      if (disposed) return;
      setConnected(false); setError('Connection lost. Reconnecting…');
      void fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }).then(response => {
        if (disposed) return;
        if (response.status === 404) waitForTeacher();
        // A refused stream (e.g. the room was full) is not retried by EventSource itself
        else if (events.readyState === 2 /* CLOSED */) {
          pollTimer = setTimeout(() => { if (!disposed) setAttempt(value => value + 1); }, ROOM_WAIT_POLL_MS);
        }
      }).catch(() => { /* EventSource will reconnect and receive a fresh snapshot. */ });
    };
    return () => { disposed = true; clearTimeout(pollTimer); events.close(); };
  }, [code, attempt]);
  return { snapshot, connected, error, waiting };
}
