import { isReservedRoomCode, normalizeRoomCode, validRoomCode } from './protocol';
import type { ServerConfigResponse } from '../translation/protocol';

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
  return validRoomCode(code) && !isReservedRoomCode(code) ? code : null;
}

/** Short student link, e.g. https://bpmdata.github.io/murphy-p3 */
export function studentRoomUrl(code: string, base: string | null = null): string {
  return `${base || window.location.origin}/${encodeURIComponent(normalizeRoomCode(code))}`;
}

/** The address without scheme for reading aloud or writing on a board, e.g. bpmdata.github.io/murphy-p3 */
export function displayRoomUrl(code: string, base: string | null = null): string {
  return studentRoomUrl(code, base).replace(/^https?:\/\//, '');
}

let shortLinkBase: Promise<string | null> | null = null;

/**
 * The server's short-link base (production: the GitHub Pages site, whose 404 page forwards
 * `/<code>` here), or null to use this origin. Fetched once; a failure falls back to null.
 */
export function loadShortLinkBase(): Promise<string | null> {
  shortLinkBase ??= fetch('/api/config', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: Partial<ServerConfigResponse> | null) =>
      typeof data?.shortLinkBase === 'string' && /^https?:\/\//.test(data.shortLinkBase) ? data.shortLinkBase : null
    )
    .catch(() => null);
  return shortLinkBase;
}
