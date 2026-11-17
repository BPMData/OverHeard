import { normalizeRoomCode, validRoomCode } from './protocol';

// Top-level paths the app or server already uses; never treated as a room code.
const RESERVED_PATHS = new Set(['api', 'assets', 'ort', 'piper', 'index']);

/**
 * Room code for a student page: `?room=code` (original links) or the short form `/code`.
 * Returns null on the home page or any path that cannot be a room code.
 */
export function roomCodeFromLocation(location: Pick<Location, 'pathname' | 'search'>): string | null {
  const query = new URLSearchParams(location.search).get('room');
  if (query !== null) return normalizeRoomCode(query);
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]{2,39})\/?$/.exec(location.pathname);
  if (!match) return null;
  const code = normalizeRoomCode(match[1]);
  return validRoomCode(code) && !RESERVED_PATHS.has(code) ? code : null;
}

/** Short student link, e.g. https://overheard.example/murphy-p3 */
export function studentRoomUrl(code: string, origin = window.location.origin): string {
  return `${origin}/${encodeURIComponent(normalizeRoomCode(code))}`;
}

/** The address without scheme for reading aloud or writing on a board, e.g. overheard.example/murphy-p3 */
export function displayRoomUrl(code: string, origin = window.location.origin): string {
  return studentRoomUrl(code, origin).replace(/^https?:\/\//, '');
}
