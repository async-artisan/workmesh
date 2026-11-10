import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { V1Client } from '../../cli/src/client';

// Build and launch the real main.ts, including its middleware registration. This
// test explicitly removes the database URL and does not exercise database paths.
describe('production bootstrap global HTTP limiter', () => {
  const apiRoot = process.cwd();
  let buildDir = '';
  let runtimeDir = '';
  let child: ChildProcess | undefined;
  let port = 0;
  let output = '';

  beforeAll(async () => {
    buildDir = await mkdtemp(join(apiRoot, '.tmp-main-limiter-'));
    const compiler = require.resolve('typescript/bin/tsc');
    const build = spawn(
      process.execPath,
      [compiler, '-p', 'tsconfig.json', '--outDir', buildDir, '--incremental', 'false'],
      { cwd: apiRoot },
    );
    build.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    build.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((done, reject) => {
      build.once('error', reject);
      build.once('exit', done);
    });
    if (code !== 0) throw new Error(`production TypeScript build failed: ${output}`);

    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('unable to reserve port');
    port = address.port;
    await new Promise<void>((done, reject) =>
      reservation.close((error) => (error ? reject(error) : done())),
    );
    // Start outside the repository so the production bootstrap cannot discover
    // a workspace .env file. Keep this HTTP-only smoke process disconnected from
    // every database target, including inherited PostgreSQL client settings.
    runtimeDir = await mkdtemp(join(tmpdir(), 'workmesh-main-limiter-'));
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      // This fixture serves HTTP on loopback; do not inherit deployment cookie
      // settings or fall back to SECURE with the production HTTP default origin.
      WORKMESH_COOKIE_MODE: 'LOCAL_INSECURE',
      WORKMESH_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      WEB_ORIGIN: `http://127.0.0.1:${port}`,
      RATE_LIMIT_MAX: '1',
      RATE_LIMIT_BUCKETS: '10000',
      TRUSTED_PROXY_IPS: '',
    };
    for (const key of [
      'WORKMESH_TEST_ENV',
      'WORKMESH_TEST_DATABASE_URL',
      'WORKMESH_TEST_DATABASE_USERS',
      'DATABASE_URL',
      'DIRECT_URL',
      'SHADOW_DATABASE_URL',
      'TEST_DATABASE_URL',
      'PGHOST',
      'PGPORT',
      'PGDATABASE',
      'PGUSER',
      'PGPASSWORD',
      'PGSSLMODE',
      'PGSERVICE',
      'PGSERVICEFILE',
    ]) {
      delete env[key];
    }
    // Prisma's generated client can discover a repository .env while loading;
    // keep the application variable present but empty so dotenv discovery
    // cannot repopulate it and the HTTP-only bootstrap remains disconnected.
    env.WORKMESH_V1_DATABASE_URL = '';
    env.DATABASE_URL = '';
    child = spawn(process.execPath, [join(buildDir, 'main.js')], {
      cwd: runtimeDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(`production bootstrap exited ${child.exitCode}: ${output}`);
      const ready = await new Promise<boolean>((done) => {
        const socket = connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          done(true);
        });
        socket.once('error', () => done(false));
      });
      if (ready) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`production bootstrap did not listen: ${output}`);
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise<void>((done) => {
        child?.once('exit', () => done());
        setTimeout(done, 3000).unref();
      });
    }
    if (buildDir && resolve(buildDir).startsWith(`${resolve(apiRoot)}${sep}.tmp-main-limiter-`))
      await rm(buildDir, { recursive: true, force: true });
    if (runtimeDir) await rm(runtimeDir, { recursive: true, force: true });
  });

  it('applies global limit before guard and returns the v1 error envelope', async () => {
    const url = `http://127.0.0.1:${port}/api/v1/projects/11111111-1111-4111-8111-111111111111/workspace-enrollments`;
    const request = () =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const first = await request();
    expect(first.status).toBe(401);
    const firstBody = (await first.json()) as { error: { code: string } };
    expect(firstBody.error.code).toBe('AUTH_REQUIRED');
    const limited = await request();
    const body = (await limited.json()) as {
      error: {
        code: string;
        message: string;
        requestId: string;
        details: { retryAfterSeconds: number };
      };
    };
    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-ratelimit-limit')).toBe('1');
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: '请求过于频繁',
      details: { retryAfterSeconds: expect.any(Number) },
      requestId: expect.any(String),
    });
    expect(limited.headers.get('x-request-id')).toBe(body.error.requestId);

    // The actual CLI consume caller must see RATE_LIMITED, not PROTOCOL_INVALID.
    const client = new V1Client({
      platform: { origin: `http://127.0.0.1:${port}`, apiBasePath: '/api/v1' },
    });
    await expect(client.consumeEnrollmentCode('unused-code')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSeconds: expect.any(Number) },
      requestId: expect.any(String),
    });
  }, 20_000);
});
