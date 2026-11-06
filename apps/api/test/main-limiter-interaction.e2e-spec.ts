import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { V1Client } from '../../cli/src/client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';

// Deliberately build and run the production main.ts with a guarded disposable DB.
const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;
suite('production global and enrollment consume rate limit interaction', () => {
  const apiRoot = process.cwd();
  let buildDir = '';
  let child: ChildProcess | undefined;
  let port = 0;
  let output = '';

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    const db = new PrismaClient({ datasources: { db: { url: target.url } } });
    try {
      const identity = await db.$queryRaw<
        Array<{ name: string }>
      >`SELECT current_database() AS name`;
      expect(identity[0]?.name).toBe(target.database);
    } finally {
      await db.$disconnect();
    }
    buildDir = await mkdtemp(join(apiRoot, '.tmp-limiter-interaction-'));
    const build = spawn(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.json',
        '--outDir',
        buildDir,
        '--incremental',
        'false',
      ],
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
    child = spawn(process.execPath, [join(buildDir, 'main.js')], {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        RATE_LIMIT_MAX: '11',
        RATE_LIMIT_BUCKETS: '10000',
        TRUSTED_PROXY_IPS: '',
        WORKMESH_V1_DATABASE_URL: target.url,
        WORKMESH_COOKIE_MODE: 'LOCAL_INSECURE',
        WORKMESH_PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
      },
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
    if (
      buildDir &&
      resolve(buildDir).startsWith(`${resolve(apiRoot)}${sep}.tmp-limiter-interaction-`)
    )
      await rm(buildDir, { recursive: true, force: true });
  });

  it('returns domain 429 at request 11, then global 429 before domain at request 12', async () => {
    const observed: Array<{ status: number; headers: Headers; body: unknown }> = [];
    const client = new V1Client({
      platform: { origin: `http://127.0.0.1:${port}`, apiBasePath: '/api/v1' },
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        observed.push({
          status: response.status,
          headers: response.headers,
          body: await response.clone().json(),
        });
        return response;
      },
    });
    const code = `wme_${randomBytes(32).toString('base64url')}`;
    for (let index = 0; index < 10; index += 1)
      await expect(client.consumeEnrollmentCode(code)).rejects.toMatchObject({
        code: 'ENROLLMENT_NOT_FOUND',
        status: 404,
      });
    await expect(client.consumeEnrollmentCode(code)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    await expect(client.consumeEnrollmentCode(code)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      message: '请求过于频繁',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(observed).toHaveLength(12); // POST writes are not retried by the real CLI client.
    expect(observed.slice(0, 10).map((response) => response.status)).toEqual(Array(10).fill(404));
    expect(observed[10]).toMatchObject({
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'RATE_LIMITED',
          details: { retryAfterSeconds: expect.any(Number) },
          requestId: expect.any(String),
        },
      },
    });
    expect(observed[11]).toMatchObject({
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: '请求过于频繁',
          details: { retryAfterSeconds: expect.any(Number) },
          requestId: expect.any(String),
        },
      },
    });
    expect(observed[10]?.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(observed[11]?.headers.get('retry-after')).toBeTruthy();
    const globalBody = observed[11]?.body as { error: { requestId: string } };
    expect(observed[11]?.headers.get('x-request-id')).toBe(globalBody.error.requestId);
  }, 30_000);
});
