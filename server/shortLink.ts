// Short student links (e.g. https://bpmdata.github.io/murphy-p3). The GitHub Pages site's
// 404.html forwards any unknown path to this service, so rooms need no per-room pages.
// Renamed from `over-heard` on 2026-11-28. deploy.yml also sets SHORT_LINK_BASE explicitly, which wins.
const PRODUCTION_SERVICE = 'overheard';
const PRODUCTION_SHORT_LINK_BASE = 'https://bpmdata.github.io';

/**
 * Base URL for student links, or null to use the app's own origin.
 * `SHORT_LINK_BASE` overrides it (an empty value turns it off); otherwise only the
 * production Cloud Run service uses the GitHub Pages address.
 */
export function shortLinkBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw =
    env.SHORT_LINK_BASE !== undefined
      ? env.SHORT_LINK_BASE.trim()
      : env.K_SERVICE === PRODUCTION_SERVICE
        ? PRODUCTION_SHORT_LINK_BASE
        : '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}
