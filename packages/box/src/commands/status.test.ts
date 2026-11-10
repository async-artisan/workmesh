import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterFor } from '../adapters';
import type { BoxContext } from '../context';
import { describeDatabase } from '../lib/config';
import { isPortOpen } from '../lib/net';
import { runDoctor } from './doctor';
import { collectStatus, renderStatus } from './status';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 16.0' })),
}));
vi.mock('../lib/net', () => ({ isPortOpen: vi.fn() }));
let scratch: string;
let ctx: BoxContext;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'workmesh-box-status-'));
  ctx = {
    adapter: adapterFor('win32'),
    repoRoot: null,
    dataDir: scratch,
    installRoot: scratch,
    apiPort: 3000,
    webPort: 5173,
    databaseUrl: 'postgresql://user:pass@127.0.0.1:5432/test',
    database: describeDatabase('postgresql://user:pass@127.0.0.1:5432/test'),
    pg: { source: 'path', binDir: null, pgDump: 'not-executed', psql: 'not-executed' },
    env: {},
    now: new Date('2026-11-09T00:00:00Z'),
  };
  vi.mocked(isPortOpen).mockImplementation(async (port) => port === 5432);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(scratch, { recursive: true, force: true });
});

describe('status evidence boundaries', () => {
  it('distinguishes an environment-only doctor pass from service readiness', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await runDoctor(ctx);
    expect(result.ok).toBe(true);
    expect(result.report.evidence).toEqual({
      httpAccess: 'LOOPBACK_ONLY',
      serviceReady: false,
      projectAuthorization: 'NOT_CHECKED',
      businessRelease: 'NOT_CHECKED',
      backup: 'NOT_VERIFIED',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(renderStatus(result.report)).toContain('体检通过只表示关键环境检查通过');
  });

  it('fails doctor when an HTTP process serves liveness at the readiness URL', async () => {
    vi.mocked(isPortOpen).mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => new Response(JSON.stringify({ data: { status: 'ok' } }))),
    );
    const result = await runDoctor(ctx);
    expect(result.ok).toBe(false);
    expect(result.failed).toContain('api-ready');
    expect(result.report.health.ok).toBe(true);
    expect(result.report.evidence.serviceReady).toBe(false);
  });

  it('reports ready dependency evidence without implying project access or business release', async () => {
    vi.mocked(isPortOpen).mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async (url: string) =>
            new Response(
              JSON.stringify(
                url.endsWith('/ready')
                  ? { data: { ok: true, database: { reachable: true, appliedMigrations: 20 } } }
                  : { data: { status: 'ok' } },
              ),
            ),
        ),
    );
    const report = await collectStatus(ctx);
    expect(report.ready).toMatchObject({ ok: true, appliedMigrations: 20 });
    expect(report.evidence).toMatchObject({
      serviceReady: true,
      httpAccess: 'LOOPBACK_ONLY',
      projectAuthorization: 'NOT_CHECKED',
      businessRelease: 'NOT_CHECKED',
    });
  });
});
