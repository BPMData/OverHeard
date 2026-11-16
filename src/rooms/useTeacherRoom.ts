import { useEffect, useRef, useState } from 'react';
import type { LectureState, RoomPatch } from './protocol';

const STORAGE_KEY = 'overheard.teacherRoom';
interface Credential { code: string; token: string }

function loadCredential(): Credential | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    return value && typeof value.code === 'string' && typeof value.token === 'string' ? value : null;
  } catch { return null; }
}

async function request(path: string, method: string, body?: unknown, token?: string) {
  const response = await fetch(`/api/rooms${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Room request failed.'), { status: response.status });
  return data;
}

export function useTeacherRoom(state: LectureState) {
  const latest = useRef(state);
  latest.current = state;
  const [room, setRoom] = useState<Credential | null>(loadCredential);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    try { if (room) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(room)); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* in-memory room still works */ }
  }, [room]);

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    let previous: LectureState | null = null;
    let lastSent = 0;
    let pending = false;
    let retryAt = 0;
    const sync = async () => {
      if (pending || disposed || Date.now() < retryAt) return;
      const current = latest.current;
      if (previous && previous.entries === current.entries && previous.selectedLangs === current.selectedLangs &&
          previous.interim === current.interim && previous.liveTranslations === current.liveTranslations &&
          previous.isListening === current.isListening && Date.now() - lastSent < 10_000) return;
      const old = new Map(previous?.entries.map(entry => [entry.id, entry]));
      const ids = new Set(current.entries.map(entry => entry.id));
      const patch: RoomPatch = { ...current, reset: !previous,
        entries: current.entries.filter(entry => old.get(entry.id) !== entry),
        removedIds: [...old.keys()].filter(id => !ids.has(id)) };
      pending = true;
      try {
        await request(`/${room.code}`, 'PUT', patch, room.token);
        if (!disposed) { previous = current; lastSent = Date.now(); setStatus('Sharing live'); setUnavailable(false); }
      } catch (error) {
        retryAt = Date.now() + 3000;
        if (!disposed) {
          const fatal = [403, 404, 410].includes((error as { status?: number }).status ?? 0);
          setUnavailable(fatal);
          setStatus(error instanceof Error ? error.message : 'Connection lost. Retrying…');
          if (fatal) disposed = true;
        }
      } finally { pending = false; }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 300);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [room]);

  const create = async (code: string) => {
    setBusy(true);
    try {
      const result: Credential = await request('', 'POST', { code: code.trim() || undefined });
      setRoom(result); setUnavailable(false); setStatus('Connecting…');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { setBusy(false); }
  };
  const end = async () => {
    if (!room) return;
    setBusy(true);
    try {
      if (!unavailable) await request(`/${room.code}`, 'DELETE', undefined, room.token);
      setRoom(null); setStatus(''); setUnavailable(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not end room.'); }
    finally { setBusy(false); }
  };
  return { room, status, busy, unavailable, create, end };
}
