import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit per IP, then blocks', () => {
    const limiter = createRateLimiter(3, 60_000, () => 0);
    expect([1, 2, 3].map(() => limiter.isLimited('a'))).toEqual([false, false, false]);
    expect(limiter.isLimited('a')).toBe(true);
    // Other IPs have their own budget
    expect(limiter.isLimited('b')).toBe(false);
  });

  it('frees up capacity as old requests leave the window', () => {
    let now = 0;
    const limiter = createRateLimiter(2, 1_000, () => now);
    limiter.isLimited('a');
    now = 500;
    limiter.isLimited('a');
    expect(limiter.isLimited('a')).toBe(true);
    now = 1_001; // first request is now outside the window
    expect(limiter.isLimited('a')).toBe(false);
  });

  it('prune forgets idle IPs so they start fresh', () => {
    let now = 0;
    const limiter = createRateLimiter(1, 1_000, () => now);
    limiter.isLimited('a');
    expect(limiter.isLimited('a')).toBe(true);
    now = 5_000;
    limiter.prune();
    expect(limiter.isLimited('a')).toBe(false);
  });
});
