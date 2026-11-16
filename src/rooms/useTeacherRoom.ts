import { useEffect, useRef, useState } from 'react';
import {
  normalizePin,
  normalizeRoomCode,
  validPin,
  validRoomCode,
  type LectureState,
  type RoomPatch,
  type RoomRejoinResponse,
} from './protocol';

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

export function useTeacherRoom(
  state: LectureState,
  onRestore?: (restored: Pick<LectureState, 'entries' | 'selectedLangs'>) => void,
) {
  const latest = useRef(state);
  latest.current = state;
  const [room, setRoom] = useState<Credential | null>(loadCredential);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const awaitingRestoreRef = useRef(false);
  const rejoinedBaselineRef = useRef<{ token: string; state: LectureState } | null>(null);

  useEffect(() => {
    try { if (room) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(room)); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* in-memory room still works */ }
  }, [room]);

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    let previous: LectureState | null =
      rejoinedBaselineRef.current?.token === room.token ? rejoinedBaselineRef.current.state : null;
    rejoinedBaselineRef.current = null;
    let lastSent = 0;
    let pending = false;
    let retryAt = 0;
    const sync = async () => {
      if (pending || disposed || Date.now() < retryAt) return;
      const current = latest.current;
      if (awaitingRestoreRef.current) {
        if (current.entries.length === 0) return;
        awaitingRestoreRef.current = false;
      }
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

  const create = async (code: string, pin: string) => {
    const cleanPin = normalizePin(pin);
    if (!validPin(cleanPin)) {
      setStatus('Enter a room PIN (4–20 characters) so you can rejoin if disconnected.');
      return;
    }
    awaitingRestoreRef.current = false;
    rejoinedBaselineRef.current = null;
    setBusy(true);
    try {
      const result: Credential = await request('', 'POST', { code: code.trim() || undefined, pin: cleanPin });
      setRoom(result); setUnavailable(false); setStatus('Connecting…');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { setBusy(false); }
  };

  const rejoin = async (code: string, pin: string) => {
    const cleanCode = normalizeRoomCode(code);
    if (!validRoomCode(cleanCode)) {
      setStatus('Enter the room code you want to rejoin.');
      return;
    }
    const cleanPin = normalizePin(pin);
    if (!validPin(cleanPin)) {
      setStatus('Enter the room PIN (4–20 characters).');
      return;
    }
    setBusy(true);
    try {
      const result: RoomRejoinResponse = await request(`/${encodeURIComponent(cleanCode)}/rejoin`, 'POST', { pin: cleanPin });
      const localEmpty = latest.current.entries.length === 0;
      if (localEmpty && (result.snapshot.entries.length > 0 || result.snapshot.selectedLangs.length > 0)) {
        awaitingRestoreRef.current = result.snapshot.entries.length > 0;
        rejoinedBaselineRef.current = {
          token: result.token,
          state: {
            entries: result.snapshot.entries,
            selectedLangs: result.snapshot.selectedLangs,
            interim: '',
            liveTranslations: {},
            isListening: false,
          },
        };
        onRestore?.({ entries: result.snapshot.entries, selectedLangs: result.snapshot.selectedLangs });
      } else {
        awaitingRestoreRef.current = false;
        rejoinedBaselineRef.current = null;
      }
      setRoom({ code: result.code, token: result.token });
      setUnavailable(false);
      setStatus('Rejoining…');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not rejoin room.');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!room) return;
    setBusy(true);
    try {
      if (!unavailable) await request(`/${room.code}`, 'DELETE', undefined, room.token);
      awaitingRestoreRef.current = false;
      rejoinedBaselineRef.current = null;
      setRoom(null); setStatus(''); setUnavailable(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not end room.'); }
    finally { setBusy(false); }
  };
  return { room, status, busy, unavailable, create, rejoin, end };
}
