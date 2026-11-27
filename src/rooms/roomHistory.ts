import { normalizeRoomCode, validRoomCode } from './protocol';

export const ROOM_HISTORY_STORAGE_KEY = 'overheard.teacherRoomHistory';
export const MAX_ROOM_HISTORY = 20;

export interface RoomHistoryEntry {
  code: string;
  createdAt: number;
  lastUsedAt: number;
}

export type RoomLiveStatus = 'checking' | 'live' | 'ended' | 'expired' | 'unknown';

function sanitizeEntries(raw: unknown): RoomHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const byCode = new Map<string, RoomHistoryEntry>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawCode = (item as { code?: unknown }).code;
    if (typeof rawCode !== 'string') continue;
    const code = normalizeRoomCode(rawCode);
    if (!validRoomCode(code)) continue;
    const createdAtRaw = (item as { createdAt?: unknown }).createdAt;
    const lastUsedAtRaw = (item as { lastUsedAt?: unknown }).lastUsedAt;
    const lastUsedAt = typeof lastUsedAtRaw === 'number' && Number.isFinite(lastUsedAtRaw) ? lastUsedAtRaw : Date.now();
    const createdAt = typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : lastUsedAt;
    const prev = byCode.get(code);
    if (!prev || lastUsedAt > prev.lastUsedAt) {
      byCode.set(code, {
        code,
        createdAt: prev ? Math.min(prev.createdAt, createdAt) : createdAt,
        lastUsedAt,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ROOM_HISTORY);
}

function saveRoomHistory(entries: RoomHistoryEntry[]): void {
  try {
    localStorage.setItem(ROOM_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore storage quota / private-mode errors */
  }
}

export function loadRoomHistory(): RoomHistoryEntry[] {
  try {
    const raw = localStorage.getItem(ROOM_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function recordRoomHistory(rawCode: string, now = Date.now()): RoomHistoryEntry[] {
  const code = normalizeRoomCode(rawCode);
  if (!validRoomCode(code)) return loadRoomHistory();
  const current = loadRoomHistory();
  const existing = current.find((entry) => entry.code === code);
  const nextEntry: RoomHistoryEntry = {
    code,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  };
  const updated = [nextEntry, ...current.filter((entry) => entry.code !== code)].slice(0, MAX_ROOM_HISTORY);
  saveRoomHistory(updated);
  return updated;
}

export function clearRoomHistory(): void {
  try {
    localStorage.removeItem(ROOM_HISTORY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function checkRoomLiveStatus(rawCode: string): Promise<Exclude<RoomLiveStatus, 'checking'>> {
  const code = normalizeRoomCode(rawCode);
  if (!validRoomCode(code)) return 'expired';
  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8_000)
        : undefined;
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) return 'expired';
    if (!response.ok) return 'unknown';
    const data = (await response.json()) as { ended?: unknown };
    return data?.ended === true ? 'ended' : 'live';
  } catch {
    return 'unknown';
  }
}

export function formatRoomAge(timestamp: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
