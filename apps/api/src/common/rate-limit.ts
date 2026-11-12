/** Bounded, process-local fixed-window limiter. Use an upstream shared limiter
 * when the service is deployed with multiple replicas. */
import type { Socket } from 'node:net';
import { createConnection } from 'node:net';

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

/**
 * Shared rate limit result, matching the in-process RateLimiter.take() shape.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

/**
 * Rate limit backend interface. Both the in-process limiter and the Redis-backed
 * limiter implement this so main.ts can swap them based on REDIS_URL configuration.
 */
export interface RateLimitBackend {
  take(key: string): Promise<RateLimitResult>;
}

/**
 * Adapter wrapping the in-process RateLimiter as an async RateLimitBackend.
 */
export class LocalRateLimitBackend implements RateLimitBackend {
  constructor(private readonly limiter: RateLimiter) {}
  async take(key: string): Promise<RateLimitResult> {
    return this.limiter.take(key);
  }
}

/**
 * Redis-backed fixed-window rate limiter using a zero-dependency RESP client.
 *
 * Each window key is stored as `workmesh:rl:<bucketKey>:<windowStart>`. INCR
 * atomically increments the counter; the first INCR sets a TTL via EXPIRE so
 * the key auto-expires at the end of the window. This is the standard Redis
 * fixed-window pattern and works correctly across multiple API instances.
 *
 * On connection error the limiter fails open (returns allowed=true with
 * remaining=0) to avoid taking the whole service down when Redis is briefly
 * unavailable; the caller should log the degradation. Set failClosed=true
 * to instead reject all traffic when Redis is unreachable.
 */
export class RedisRateLimitBackend implements RateLimitBackend {
  private readonly keyPrefix: string;
  private socket: Socket | undefined;
  private reconnectPending = false;

  constructor(
    private readonly redisUrl: string,
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly failClosed = false,
    keyPrefix = 'workmesh:rl',
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error('INVALID_RATE_LIMIT_CONFIGURATION');
    this.keyPrefix = keyPrefix;
  }

  async take(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const redisKey = `${this.keyPrefix}:${key}:${windowStart}`;
    const ttlSeconds = Math.ceil(this.windowMs / 1000);
    try {
      const count = await this.incrWithTtl(redisKey, ttlSeconds);
      const allowed = count <= this.limit;
      const remaining = Math.max(0, this.limit - count);
      const retryAfter = Math.max(1, Math.ceil((windowStart + this.windowMs - now) / 1000));
      return { allowed, remaining, retryAfter };
    } catch (error) {
      if (this.failClosed) throw error;
      // Fail open: allow the request but report zero remaining so the client
      // backs off. The caller should log this degradation.
      return { allowed: true, remaining: 0, retryAfter: 1 };
    }
  }

  /** Close the underlying Redis connection. Safe to call multiple times. */
  async close(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private ensureSocket(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed && this.socket.writable) {
      return Promise.resolve(this.socket);
    }
    if (this.reconnectPending) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (this.socket && !this.socket.destroyed && this.socket.writable) resolve(this.socket);
          else reject(new Error('REDIS_RECONNECT_IN_PROGRESS'));
        };
        setTimeout(check, 50);
      });
    }
    this.reconnectPending = true;
    return this.connect();
  }

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.redisUrl);
      const host = url.hostname;
      const port = url.port ? Number(url.port) : 6379;
      const socket = createConnection({ host, port }, () => {
        this.socket = socket;
        this.reconnectPending = false;
        // Authenticate if password is in the URL.
        const password = url.password ? decodeURIComponent(url.password) : '';
        const username = url.username ? decodeURIComponent(url.username) : '';
        if (password) {
          this.sendCommand(
            username ? ['AUTH', username, password] : ['AUTH', password],
            socket,
          ).catch(() => undefined);
        }
        resolve(socket);
      });
      socket.setNoDelay(true);
      socket.setTimeout(5_000);
      socket.once('error', () => {
        this.reconnectPending = false;
        this.socket = undefined;
        reject(new Error('REDIS_CONNECTION_FAILED'));
      });
      socket.once('timeout', () => {
        socket.destroy();
        this.reconnectPending = false;
        this.socket = undefined;
        reject(new Error('REDIS_CONNECTION_TIMEOUT'));
      });
    });
  }

  private async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const socket = await this.ensureSocket();
    // INCR then EXPIRE (only on first increment to avoid resetting TTL).
    const incrResult = await this.sendCommand(['INCR', key], socket);
    if (typeof incrResult !== 'number') throw new Error('REDIS_INCR_FAILED');
    if (incrResult === 1) {
      await this.sendCommand(['EXPIRE', key, String(ttlSeconds)], socket);
    }
    return incrResult;
  }

  private sendCommand(args: string[], socket: Socket): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const resp = `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`;
      const chunks: Buffer[] = [];
      const onReadable = () => {
        const data = socket.read();
        if (data) chunks.push(data);
        const parsed = parseResp(Buffer.concat(chunks));
        if (parsed !== null) {
          cleanup();
          if (parsed.kind === 'error') reject(new Error(`REDIS_ERROR: ${parsed.value}`));
          else resolve(parsed.value);
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error('REDIS_COMMAND_FAILED'));
      };
      const cleanup = () => {
        socket.off('readable', onReadable);
        socket.off('error', onError);
      };
      socket.on('readable', onReadable);
      socket.on('error', onError);
      socket.write(resp);
    });
  }
}

/** Minimal RESP2 parser. Returns null if the buffer is incomplete. */
function parseResp(buf: Buffer): { kind: 'integer' | 'string' | 'error'; value: unknown } | null {
  if (buf.length < 3) return null;
  const type = buf[0];
  const lineEnd = buf.indexOf('\r\n', 1);
  if (lineEnd === -1) return null;
  const line = buf.subarray(1, lineEnd).toString('utf8');
  if (type === 0x3a /* ':' */) return { kind: 'integer', value: Number(line) };
  if (type === 0x2b /* '+' */) return { kind: 'string', value: line };
  if (type === 0x2d /* '-' */) return { kind: 'error', value: line };
  if (type === 0x24 /* '$' */) {
    const len = Number(line);
    if (len < 0) return { kind: 'string', value: null };
    const totalLen = lineEnd + 2 + len + 2;
    if (buf.length < totalLen) return null;
    return { kind: 'string', value: buf.subarray(lineEnd + 2, lineEnd + 2 + len).toString('utf8') };
  }
  return { kind: 'error', value: `UNSUPPORTED_RESP_TYPE: ${String.fromCharCode(type)}` };
}

/**
 * Factory: pick the right rate limit backend based on environment.
 *
 * - No REDIS_URL: in-process RateLimiter (single-instance default).
 * - REDIS_URL set: RedisRateLimitBackend (multi-instance, shared state).
 *
 * Returns the backend and a cleanup function (call on shutdown).
 */
export async function createRateLimitBackend(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ backend: RateLimitBackend; cleanup: () => Promise<void> }> {
  const limit = Number(env.RATE_LIMIT_MAX ?? 120);
  const capacity = Number(env.RATE_LIMIT_BUCKETS ?? 10_000);
  if (env.REDIS_URL) {
    const redisBackend = new RedisRateLimitBackend(env.REDIS_URL, limit);
    return { backend: redisBackend, cleanup: () => redisBackend.close() };
  }
  const limiter = new RateLimiter(limit, capacity);
  return { backend: new LocalRateLimitBackend(limiter), cleanup: async () => {} };
}
