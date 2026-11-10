import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BoxContext } from '../context';
import { isPortOpen, waitForHttp, waitForPort } from '../lib/net';
import { isReadyPayload, readinessFailureDetail } from './status';

export type DevStep = {
  name: string;
  port: number;
  listening: boolean;
  ready?: boolean;
  started: boolean;
  detail: string;
};

export type DevReport = {
  ok: boolean;
  steps: DevStep[];
  urls: { web: string; api: string };
  hint: string | null;
};

function spawnLogged(input: {
  command: string;
  args: string[];
  cwd: string;
  logFile: string;
}): void {
  mkdirSync(dirname(input.logFile), { recursive: true });
  const fd = openSync(input.logFile, 'a');
  try {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      detached: true,
      stdio: ['ignore', fd, fd],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
}

/** 本机 dev 用 embedded-postgres 时，启动脚本在 %LOCALAPPDATA%\\workmesh-pg。 */
function databaseStart(ctx: BoxContext): { command: string; args: string[] } | null {
  const pgHome = ctx.env.LOCALAPPDATA ? join(ctx.env.LOCALAPPDATA, 'workmesh-pg') : null;
  if (!pgHome) return null;
  const startScript = join(pgHome, 'start-pg.mjs');
  if (!existsSync(startScript)) return null;
  return { command: 'node', args: [startScript] };
}

/** 验证数据库与迁移的就绪证据，同时保留失败原因。 */
async function readinessDetail(port: number): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: unknown;
      error?: { details?: { reason?: string } };
    } | null;
    if (response.ok && isReadyPayload(body)) return { ok: true, detail: 'ok' };
    return {
      ok: false,
      detail: response.ok
        ? '不就绪：响应缺少数据库可达与迁移证据'
        : `不就绪：${readinessFailureDetail(response.status, body?.error?.details?.reason)}`,
    };
  } catch (caught) {
    return { ok: false, detail: (caught as Error).message };
  }
}

/**
 * 本机开发：确保 PG 可达 → 起 API → 起 Web；已在监听的一律跳过，可反复执行。
 * --check 只报告状态，不启动任何进程。
 */
export async function runDev(
  ctx: BoxContext,
  input: { check: boolean; spawn?: boolean } = { check: false },
): Promise<DevReport> {
  const steps: DevStep[] = [];
  const dbPort = ctx.database?.port ?? 5432;
  const dbHost = ctx.database?.host ?? '127.0.0.1';
  let hint: string | null = null;

  let dbListening = await isPortOpen(dbPort, dbHost);
  let dbStarted = false;
  if (!dbListening && !input.check) {
    const start = databaseStart(ctx);
    if (!start) {
      hint = '启动本机 PostgreSQL（默认端口 5432），或把 WORKMESH_V1_DATABASE_URL 指向已有实例';
    } else {
      spawnLogged({
        command: start.command,
        args: start.args,
        cwd: ctx.repoRoot ?? process.cwd(),
        logFile: join(ctx.dataDir, 'logs', 'postgres.log'),
      });
      dbListening = await waitForPort(dbPort, { host: dbHost, timeoutMs: 30_000 });
      dbStarted = dbListening;
    }
  }
  steps.push({
    name: 'postgres',
    port: dbPort,
    listening: dbListening,
    started: dbStarted,
    detail: dbListening ? '端口已监听' : '未监听',
  });

  const apiListeningBefore = await isPortOpen(ctx.apiPort);
  let apiListening = apiListeningBefore;
  let apiHealth = apiListeningBefore
    ? await readinessDetail(ctx.apiPort)
    : { ok: false, detail: '未运行' };
  let apiStarted = false;
  if (!apiListening && !input.check) {
    if (!ctx.repoRoot)
      throw new Error('找不到仓库根目录：dev 模式需要从仓库运行（打包形态用 install/start）');
    spawnLogged({
      command: 'pnpm',
      args: ['--filter', '@workmesh/api', 'dev'],
      cwd: ctx.repoRoot,
      logFile: join(ctx.dataDir, 'logs', 'api.log'),
    });
    // 等「就绪」而不是等「存活」：数据库没迁移或连不上时不能报启动成功。
    const apiReady = await waitForHttp(`http://127.0.0.1:${ctx.apiPort}/api/health/ready`, {
      timeoutMs: 120_000,
      accept: async (response) => isReadyPayload(await response.json().catch(() => null)),
    });
    apiListening = await isPortOpen(ctx.apiPort);
    apiStarted = apiListening;
    apiHealth = apiReady
      ? { ok: true, detail: 'ok' }
      : {
          ok: false,
          detail: `启动超时（120s 内就绪探针未通过：${(await readinessDetail(ctx.apiPort)).detail}）`,
        };
  }
  steps.push({
    name: 'api',
    port: ctx.apiPort,
    listening: apiListening,
    ready: apiHealth.ok,
    started: apiStarted,
    detail: apiHealth.detail,
  });

  const webListeningBefore = await isPortOpen(ctx.webPort);
  let webListening = webListeningBefore;
  let webStarted = false;
  if (!webListening && !input.check) {
    if (!ctx.repoRoot) throw new Error('找不到仓库根目录：dev 模式需要从仓库运行');
    spawnLogged({
      command: 'pnpm',
      args: ['--filter', '@workmesh/web', 'dev'],
      cwd: ctx.repoRoot,
      logFile: join(ctx.dataDir, 'logs', 'web.log'),
    });
    webListening = await waitForPort(ctx.webPort, { timeoutMs: 90_000 });
    webStarted = webListening;
  }
  steps.push({
    name: 'web',
    port: ctx.webPort,
    listening: webListening,
    started: webStarted,
    detail: webListening ? '端口已监听' : '未监听',
  });

  if (hint) steps[0].detail = hint;

  return {
    ok: steps.every((step) => step.ready ?? step.listening),
    steps,
    urls: {
      web: `http://127.0.0.1:${ctx.webPort}`,
      api: `http://127.0.0.1:${ctx.apiPort}/api/health/ready`,
    },
    hint,
  };
}
