import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterFor } from '../adapters';
import type { BoxContext } from '../context';
import { describeDatabase } from '../lib/config';
import { isPortOpen, waitForHttp } from '../lib/net';
import { runDev } from './dev';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('../lib/net', () => ({ isPortOpen: vi.fn(), waitForHttp: vi.fn(), waitForPort: vi.fn() }));

const ctx: BoxContext = {
  adapter: adapterFor('win32'),
  repoRoot: null,
  dataDir: 'unused-test-data',
  installRoot: 'unused-test-install',
  apiPort: 3000,
  webPort: 5173,
  databaseUrl: 'postgresql://user:pass@127.0.0.1:5432/test',
  database: describeDatabase('postgresql://user:pass@127.0.0.1:5432/test'),
  pg: null,
  env: {},
  now: new Date('2026-11-09T00:00:00Z'),
};
const ready = { data: { ok: true, database: { reachable: true, appliedMigrations: 20 } } };

describe('runDev readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPortOpen).mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fails when an existing API listens but its readiness fails, without spawning onto the occupied port', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { details: { reason: 'CONNECT_FAILED' } } }), {
          status: 503,
        }),
      ),
    );
    const report = await runDev(ctx);
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.name === 'api')).toMatchObject({
      listening: true,
      ready: false,
      started: false,
      detail: expect.stringContaining('数据库不可达'),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(waitForHttp).not.toHaveBeenCalled();
  });

  it('accepts an existing ready API and exposes its readiness URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(ready))));
    const report = await runDev(ctx, { check: true });
    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.name === 'api')).toMatchObject({
      listening: true,
      ready: true,
    });
    expect(report.urls.api).toBe('http://127.0.0.1:3000/api/health/ready');
  });

  it.each([
    { data: { status: 'ok' } },
    { data: { ok: true, database: { reachable: true, appliedMigrations: 0 } } },
    { data: { ok: true, database: { reachable: true, appliedMigrations: 1.5 } } },
    { data: { ok: 'true', database: { reachable: true, appliedMigrations: 20 } } },
    { data: { ok: true, database: { reachable: false, appliedMigrations: 20 } } },
  ])('does not accept an HTTP 200 without valid readiness evidence: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    expect((await runDev(ctx, { check: true })).ok).toBe(false);
  });

  it('keeps a listening API unready when its probe cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('probe timed out')));
    const report = await runDev(ctx, { check: true });
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.name === 'api')).toMatchObject({
      listening: true,
      ready: false,
      detail: 'probe timed out',
    });
  });
});
