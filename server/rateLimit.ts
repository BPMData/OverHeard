// Per-IP sliding-window rate limiter.

export interface RateLimiter {
  /** Records a request from `ip` and returns true if it's over the limit. */
  isLimited(ip: string): boolean;
  /** Drops IPs with no requests in the current window. */
  prune(): void;
}

export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
  now: () => number = Date.now
): RateLimiter {
  const bucket = new Map<string, number[]>();
  return {
    isLimited(ip) {
      const t = now();
      const timestamps = (bucket.get(ip) || []).filter((s) => s > t - windowMs);
      if (timestamps.length >= maxRequests) {
        bucket.set(ip, timestamps);
        return true;
      }
      timestamps.push(t);
      bucket.set(ip, timestamps);
      return false;
    },
    prune() {
      const cutoff = now() - windowMs;
      for (const [ip, times] of bucket.entries()) {
        const valid = times.filter((s) => s > cutoff);
        if (valid.length === 0) bucket.delete(ip);
        else bucket.set(ip, valid);
      }
    },
  };
}
