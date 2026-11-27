import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizePin,
  normalizeRoomCode,
  validPin,
  validRoomCode,
  type LectureState,
  type RoomPatch,
  type RoomRejoinResponse,
} from './protocol';

import { recordRoomHistory } from './roomHistory';

const STORAGE_KEY = 'overheard.teacherRoom';
const RETRY_DELAYS_MS = [500, 1000] as const;

interface Credential {
  code: string;
  token: string;
}
type FailedAction = { kind: 'create' | 'rejoin'; code: string; pin: string };
type RoomRequestError = Error & { status?: number; retryable?: boolean };

function loadCredential(): Credential | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    return value && typeof value.code === 'string' && typeof value.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

function createRequestSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs
  );
  return { signal: controller.signal, cleanup: () => window.clearTimeout(timer) };
}

function isTransientRoomError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as RoomRequestError;
  if (err.retryable === true) return true;
  if (typeof err.status === 'number') return [502, 503, 504].includes(err.status);
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return (
      error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      /failed to fetch|load failed|networkerror|network request failed/i.test(error.message)
    );
  }
  return false;
}

function formatRoomError(error: unknown, fallback: string): string {
  const err = error as RoomRequestError | undefined;
  if (typeof err?.status === 'number') {
    if ([502, 503, 504].includes(err.status)) {
      return 'The OverHeard server is temporarily busy or restarting. Please try again in a moment.';
    }
    return err.message || fallback;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Reconnect to the internet and try again.';
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'The server took too long to respond. Please check your connection and try again.';
  }
  if (isTransientRoomError(error)) {
    return 'Could not reach the OverHeard server. Check your internet connection or refresh the page, then try again.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function request(path: string, method: string, body?: unknown, token?: string) {
  const { signal, cleanup } = createRequestSignal(15_000);
  try {
    const response = await fetch(`/api/rooms${path}`, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    let data: { error?: unknown } | null = null;
    if (typeof response.text === 'function') {
      const raw = await response.text();
      if (raw) {
        try {
          data = JSON.parse(raw) as { error?: unknown };
        } catch {
          data = null;
        }
      }
    } else if (typeof response.json === 'function') {
      try {
        data = (await response.json()) as { error?: unknown };
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const serverMsg = typeof data?.error === 'string' && data.error.trim() ? data.error : '';
      const error: RoomRequestError = Object.assign(
        new Error(serverMsg || `Room request failed (HTTP ${response.status}).`),
        {
          status: response.status,
          retryable: [502, 503, 504].includes(response.status),
        }
      );
      throw error;
    }
    if (data === null) {
      const error: RoomRequestError = Object.assign(new Error('Unexpected response from server.'), { retryable: true });
      throw error;
    }
    return data;
  } finally {
    cleanup();
  }
}

export function useTeacherRoom(
  state: LectureState,
  onRestore?: (restored: Pick<LectureState, 'entries' | 'selectedLangs'>) => void
) {
  const latest = useRef(state);
  latest.current = state;
  const [room, setRoom] = useState<Credential | null>(loadCredential);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const awaitingRestoreRef = useRef(false);
  const rejoinedBaselineRef = useRef<{ token: string; state: LectureState } | null>(null);
  const lastFailedActionRef = useRef<FailedAction | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      if (room) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(room));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* in-memory room still works */
    }
    if (room?.code) recordRoomHistory(room.code);
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
      if (
        previous &&
        previous.entries === current.entries &&
        previous.selectedLangs === current.selectedLangs &&
        previous.interim === current.interim &&
        previous.liveTranslations === current.liveTranslations &&
        previous.isListening === current.isListening &&
        Date.now() - lastSent < 10_000
      )
        return;
      const old = new Map(previous?.entries.map((entry) => [entry.id, entry]));
      const ids = new Set(current.entries.map((entry) => entry.id));
      const patch: RoomPatch = {
        ...current,
        reset: !previous,
        entries: current.entries.filter((entry) => old.get(entry.id) !== entry),
        removedIds: [...old.keys()].filter((id) => !ids.has(id)),
      };
      pending = true;
      try {
        await request(`/${room.code}`, 'PUT', patch, room.token);
        if (!disposed) {
          previous = current;
          lastSent = Date.now();
          setStatus('Sharing live');
          setUnavailable(false);
        }
      } catch (error) {
        retryAt = Date.now() + 3000;
        if (!disposed) {
          const fatal = [403, 404, 410].includes((error as { status?: number }).status ?? 0);
          setUnavailable(fatal);
          setStatus(
            fatal ? formatRoomError(error, 'This room is no longer available.') : 'Connection interrupted — retrying…'
          );
          if (fatal) disposed = true;
        }
      } finally {
        pending = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [room]);

  const requestWithRetry = useCallback(async (path: string, method: string, body?: unknown, token?: string) => {
    let attempt = 0;
    while (true) {
      try {
        return await request(path, method, body, token);
      } catch (error) {
        if (!isTransientRoomError(error) || attempt >= RETRY_DELAYS_MS.length) {
          throw error;
        }
        const delayMs = RETRY_DELAYS_MS[attempt];
        attempt += 1;
        if (mountedRef.current) {
          setStatus(`Connection interrupted — retrying (${attempt}/${RETRY_DELAYS_MS.length})…`);
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        if (!mountedRef.current) throw error;
      }
    }
  }, []);

  const clearRetry = useCallback(() => {
    lastFailedActionRef.current = null;
    setCanRetry(false);
  }, []);

  const rejoin = useCallback(
    async (code: string, pin: string, options?: { afterConflict?: boolean }) => {
      const cleanCode = normalizeRoomCode(code);
      clearRetry();
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
      setStatus('');
      try {
        const result = (await requestWithRetry(`/${encodeURIComponent(cleanCode)}/rejoin`, 'POST', {
          pin: cleanPin,
        })) as RoomRejoinResponse;
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        if (isTransientRoomError(error)) {
          lastFailedActionRef.current = { kind: 'rejoin', code, pin };
          setCanRetry(true);
        }
        setStatus(
          options?.afterConflict && (error as RoomRequestError).status === 403
            ? 'That room code is already in use with a different PIN. Enter its PIN or choose another code.'
            : formatRoomError(error, 'Could not rejoin room.')
        );
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [clearRetry, onRestore, requestWithRetry]
  );

  const create = useCallback(
    async (code: string, pin: string) => {
      const cleanPin = normalizePin(pin);
      clearRetry();
      if (!validPin(cleanPin)) {
        setStatus('Enter a room PIN (4–20 characters) so you can rejoin if disconnected.');
        return;
      }
      awaitingRestoreRef.current = false;
      rejoinedBaselineRef.current = null;
      setBusy(true);
      setStatus('');
      try {
        const result = (await requestWithRetry('', 'POST', {
          code: code.trim() || undefined,
          pin: cleanPin,
        })) as Credential;
        if (!mountedRef.current) return;
        setRoom(result);
        setUnavailable(false);
        setStatus('Connecting…');
      } catch (error) {
        if (!mountedRef.current) return;
        // A class code reused every day: if the room still exists, reopen it with the same PIN
        if ((error as RoomRequestError).status === 409 && code.trim()) {
          setBusy(false);
          await rejoin(code, pin, { afterConflict: true });
          return;
        }
        if (isTransientRoomError(error)) {
          lastFailedActionRef.current = { kind: 'create', code, pin };
          setCanRetry(true);
        }
        setStatus(formatRoomError(error, 'Could not create room.'));
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [clearRetry, rejoin, requestWithRetry]
  );

  const retryLast = useCallback(async () => {
    const action = lastFailedActionRef.current;
    if (!action || busy) return;
    if (action.kind === 'create') {
      await create(action.code, action.pin);
    } else {
      await rejoin(action.code, action.pin);
    }
  }, [busy, create, rejoin]);

  const end = useCallback(async () => {
    if (!room) return;
    setBusy(true);
    try {
      if (!unavailable) await requestWithRetry(`/${room.code}`, 'DELETE', undefined, room.token);
      awaitingRestoreRef.current = false;
      rejoinedBaselineRef.current = null;
      clearRetry();
      setRoom(null);
      setStatus('');
      setUnavailable(false);
    } catch (error) {
      if (mountedRef.current) setStatus(formatRoomError(error, 'Could not end room.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [clearRetry, requestWithRetry, room, unavailable]);

  return { room, status, busy, unavailable, canRetry, create, rejoin, end, retryLast, clearRetry };
}
