/** Bounded, process-local fixed-window limiter. Use an upstream shared limiter
 * when the service is deployed with multiple replicas. */
export class RateLimiter {
  private readonly buckets = new Map<string, { started: number; count: number }>();
  private nextSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly capacity = 10_000,
    private readonly windowMs = 60_000,
  ) {
    if (![limit, capacity, windowMs].every((value) => Number.isSafeInteger(value) && value > 0))
      throw new Error('INVALID_RATE_LIMIT_CONFIGURATION');
  }

  take(key: string, now = Date.now()): { allowed: boolean; remaining: number; retryAfter: number } {
    if (now >= this.nextSweep) {
      for (const [ip, bucket] of this.buckets)
        if (now - bucket.started >= this.windowMs) this.buckets.delete(ip);
      this.nextSweep = now + Math.min(1000, this.windowMs);
    }
    let bucket = this.buckets.get(key);
    if (bucket && now - bucket.started >= this.windowMs) {
      bucket.started = now;
      bucket.count = 0;
    }
    if (!bucket) {
      if (this.buckets.size >= this.capacity)
        return { allowed: false, remaining: 0, retryAfter: Math.ceil(this.windowMs / 1000) };
      bucket = { started: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count = Math.min(bucket.count + 1, this.limit + 1);
    return {
      allowed: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.started + this.windowMs - now) / 1000)),
    };
  }
}
