import { describe, expect, it } from 'vitest';
import { createUsageTracker, forwardedCount } from './usage';

describe('forwardedCount', () => {
  it('counts addresses in the header', () => {
    expect(forwardedCount('203.0.113.1')).toBe(1);
    expect(forwardedCount('198.51.100.7, 203.0.113.1')).toBe(2);
    expect(forwardedCount(['a', 'b, c'])).toBe(3);
  });

  it('is 0 when the header is missing or empty', () => {
    expect(forwardedCount(undefined)).toBe(0);
    expect(forwardedCount('')).toBe(0);
    expect(forwardedCount(' , ')).toBe(0);
  });
});

describe('createUsageTracker', () => {
  it('returns null when nothing happened', () => {
    expect(createUsageTracker().flush()).toBeNull();
  });

  it('summarizes an interval and then starts over', () => {
    const usage = createUsageTracker();
    usage.seenSession('s:one');
    usage.seenSession('s:one');
    usage.seenSession('s:two');
    usage.forwardedEntries(1);
    usage.forwardedEntries(1);
    usage.mtOk('gtx', 40);
    usage.mtOk('gtx', 10);
    usage.mtOk('google-cloud', 25);
    usage.mtOk('cache', 99);
    usage.mtFailed();
    usage.refine(true);
    usage.refine(false);
    usage.rateLimited();

    expect(usage.flush()).toEqual({
      sessions: 2,
      mt: 5,
      mtFailed: 1,
      cacheHits: 1,
      byProvider: { gtx: 2, 'google-cloud': 1 },
      chars: 75,
      refine: 2,
      refineFailed: 1,
      rateLimited: 1,
      forwardedEntries: { '1': 2 },
    });
    expect(usage.flush()).toBeNull();
  });
});
