import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('bounded IP rate limiting', () => {
  it('enforces independent fixed windows and reports reset time', () => {
    const limiter = new RateLimiter(2);
    expect(limiter.take('one', 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.take('one', 1)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.take('one', 2)).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 });
    expect(limiter.take('two', 2).allowed).toBe(true);
    expect(limiter.take('one', 60_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('rejects new IPs at capacity and reclaims expired buckets without revisits', () => {
    const limiter = new RateLimiter(5, 2, 1000);
    expect(limiter.take('one', 0).allowed).toBe(true);
    expect(limiter.take('two', 0).allowed).toBe(true);
    expect(limiter.take('three', 1).allowed).toBe(false);
    expect(limiter.take('one', 1).allowed).toBe(true);
    expect(limiter.take('three', 1000)).toMatchObject({ allowed: true, remaining: 4 });
    expect(limiter.take('four', 1000).allowed).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid numeric settings: %s', (value) => {
    expect(() => new RateLimiter(value)).toThrow('INVALID_RATE_LIMIT_CONFIGURATION');
    expect(() => new RateLimiter(1, value)).toThrow('INVALID_RATE_LIMIT_CONFIGURATION');
  });
});
