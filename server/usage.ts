// Per-minute usage counters, logged as one line so Cloud Run's logs show how busy the server
// is, which translators are doing the work, and whether anything is being throttled.
// No IP addresses or text are recorded, only counts.

export interface UsageSummary {
  /** Distinct browser tabs that made a request this interval */
  sessions: number;
  /** Translation requests, including cache hits */
  mt: number;
  mtFailed: number;
  cacheHits: number;
  /** Translations by provider (cache hits excluded) */
  byProvider: Record<string, number>;
  /** Characters translated (cache hits excluded) */
  chars: number;
  refine: number;
  refineFailed: number;
  rateLimited: number;
  /** How many X-Forwarded-For entries requests carried, e.g. {"1": 120}. Normally one value. */
  forwardedEntries: Record<string, number>;
}

export interface UsageTracker {
  seenSession(key: string): void;
  forwardedEntries(count: number): void;
  mtOk(provider: string, chars: number): void;
  mtFailed(): void;
  refine(ok: boolean): void;
  rateLimited(): void;
  /** Returns this interval's counts and starts a new interval; null if nothing happened. */
  flush(): UsageSummary | null;
}

/** Number of addresses in an X-Forwarded-For header value. */
export function forwardedCount(header: unknown): number {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (typeof value !== 'string') return 0;
  return value.split(',').filter((part) => part.trim() !== '').length;
}

const fresh = () => ({
  sessions: new Set<string>(),
  mt: 0,
  mtFailed: 0,
  cacheHits: 0,
  byProvider: {} as Record<string, number>,
  chars: 0,
  refine: 0,
  refineFailed: 0,
  rateLimited: 0,
  forwardedEntries: {} as Record<string, number>,
});

export function createUsageTracker(): UsageTracker {
  let current = fresh();
  return {
    seenSession: (key) => void current.sessions.add(key),
    forwardedEntries(count) {
      const key = String(count);
      current.forwardedEntries[key] = (current.forwardedEntries[key] ?? 0) + 1;
    },
    mtOk(provider, chars) {
      current.mt++;
      if (provider === 'cache') {
        current.cacheHits++;
        return;
      }
      current.byProvider[provider] = (current.byProvider[provider] ?? 0) + 1;
      current.chars += chars;
    },
    mtFailed() {
      current.mt++;
      current.mtFailed++;
    },
    refine(ok) {
      current.refine++;
      if (!ok) current.refineFailed++;
    },
    rateLimited: () => void current.rateLimited++,
    flush() {
      const { sessions, ...counts } = current;
      current = fresh();
      const total = counts.mt + counts.refine + counts.rateLimited;
      return total === 0 ? null : { sessions: sessions.size, ...counts };
    },
  };
}
