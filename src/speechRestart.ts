// Delay before restarting speech recognition after Chrome ends it.
//
// Ordinary ends (a pause in speech, Chrome's periodic cutoff) restart immediately so no
// words are lost. A session that failed — a network error, or one that ended almost as soon
// as it started — counts as a failure, and repeated failures back off so an offline laptop
// doesn't spin start/error/end in a tight loop.

/** A recognition session shorter than this is treated as a failed start. */
export const QUICK_END_MS = 1000;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 5000;

export function isFailedSession(lastError: string | null, sessionMs: number): boolean {
  return lastError === 'network' || sessionMs < QUICK_END_MS;
}

/** Milliseconds to wait before the next start(), given consecutive failed sessions. */
export function restartDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS);
}
