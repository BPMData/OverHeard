// A random ID for this browser tab, sent with every API request so the server can
// rate-limit each teacher separately even when a whole school shares one public IP.

const SESSION_STORAGE_KEY = 'overheard.sessionId';

let memoryId: string | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getSessionId(): string {
  try {
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) return saved;
    const id = memoryId ?? randomId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    memoryId = id;
    return id;
  } catch {
    // Storage blocked (private window, site data disabled): keep one ID for this page load
    memoryId ??= randomId();
    return memoryId;
  }
}

export const SESSION_HEADER = 'X-OverHeard-Session';
