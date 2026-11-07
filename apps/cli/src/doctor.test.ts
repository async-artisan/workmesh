import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDoctorReady, readinessUrl, runDoctor, supportedNode } from './doctor';
import { main } from './index';
import { snapshotTree, writeV1Workspace } from './workspace-fixtures';
import { writePrivateFile } from './private-fs';

afterEach(() => vi.restoreAllMocks());
async function environment() {
  const root = await mkdtemp(join(tmpdir(), 'wm-doctor-'));
  return { workspaceDir: root, configHome: join(root, 'config-home'), nodeVersion: 'v24.22.1' };
}

describe('doctor preflight', () => {
  it('汇总多个独立错误，联网不发送授权或一次性码，报告不回显响应正文', async () => {
    const options = await environment();
    const network = vi.fn(async () => new Response('do-not-expose-secret', { status: 503 }));
    const report = await runDoctor({
      ...options,
      workspaceDir: join(options.workspaceDir, 'missing'),
      nodeVersion: 'v20.13.1',
      api: 'http://127.0.0.1:3000/api/v1',
      role: 'missing-role',
      online: true,
      fetch: network,
    });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((item) => item.status === 'fail').map((item) => item.id)).toEqual(
      expect.arrayContaining(['runtime', 'directory', 'role-package', 'service']),
    );
    expect(network).toHaveBeenCalledOnce();
    const request = network.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe('http://127.0.0.1:3000/api/health/ready');
    expect(request[1]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(JSON.stringify(request[1])).not.toMatch(/authorization|bearer|join|secret/i);
    expect(JSON.stringify(report)).not.toContain('do-not-expose-secret');
    expect(() => assertDoctorReady(report)).toThrow('未开始授权或消费接入码');
  });

  it('默认只读离线并校验内置资源；未绑定仅提示，不把未授权写成有效', async () => {
    const options = await environment();
    const before = await snapshotTree(options.workspaceDir);
    const network = vi.fn();
    const report = await runDoctor({ ...options, role: 'frontend', fetch: network });
    expect(report.ok).toBe(true);
    expect(report.checks.find((item) => item.id === 'role-package')).toMatchObject({
      status: 'pass',
    });
    expect(report.checks.find((item) => item.id === 'credential')).toMatchObject({
      status: 'warn',
    });
    expect(network).not.toHaveBeenCalled();
    expect(report.writes).toEqual([]);
    expect(await snapshotTree(options.workspaceDir)).toEqual(before);
  });

  it('明确开启的权限探针仅在目标父目录创建临时文件并移除', async () => {
    const options = await environment();
    const before = await readdir(options.workspaceDir);
    const report = await runDoctor({ ...options, probeStorage: true });
    expect(report.checks.find((item) => item.id === 'credential-storage')).toMatchObject({
      status: 'pass',
    });
    expect(await readdir(options.workspaceDir)).toEqual(before);
    expect(report.writes).toHaveLength(1);
  });

  it('从绑定读取平台，保留反向代理前缀，正确解析 readiness envelope', async () => {
    const options = await environment();
    await writeV1Workspace(options.workspaceDir, {
      platform: { origin: 'https://mesh.example.com', apiBasePath: '/team/api/v1' },
    });
    const network = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { ok: true, database: { reachable: true } },
            meta: { requestId: 'ready' },
          }),
          { status: 200 },
        ),
    );
    const report = await runDoctor({ ...options, online: true, fetch: network });
    expect(report.projectId).not.toBeNull();
    expect((network.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      'https://mesh.example.com/team/api/health/ready',
    );
    expect(report.checks.find((item) => item.id === 'service')).toMatchObject({ status: 'pass' });
  });

  it('非法平台不联网；200 HTML/错误JSON结构不能误判就绪', async () => {
    const options = await environment();
    const network = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    const invalid = await runDoctor({
      ...options,
      api: 'https://user:password@mesh.example.com/api/v1',
      online: true,
      fetch: network,
    });
    expect(invalid.ok).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid)).not.toContain('password');
    const other = await runDoctor({
      ...options,
      api: 'https://mesh.example.com/api/v1',
      online: true,
      fetch: network,
    });
    expect(other.checks.find((item) => item.id === 'service')).toMatchObject({ status: 'fail' });
  });

  it('doctor JSON 失败返回单一结构化报告及非零退出码', async () => {
    const options = await environment();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line));
    });
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const result = await main([
      'doctor',
      '--role',
      'missing-role',
      '--dir',
      options.workspaceDir,
      '--config-home',
      options.configHome,
      '--json',
    ]);
    expect(result).toBe(2);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      error: { code: 'PREFLIGHT_FAILED', details: { doctor: { ok: false } } },
    });
  });

  it('缺少匹配凭据仅提示；损坏凭据阻塞且不回显文件内容', async () => {
    const options = await environment();
    await writeV1Workspace(options.workspaceDir);
    const missing = await runDoctor({ ...options });
    expect(missing.checks.find((item) => item.id === 'credential')).toMatchObject({
      status: 'warn',
    });
    await mkdir(join(options.configHome, 'credentials'), { recursive: true });
    await writePrivateFile(
      join(options.configHome, 'credentials', 'broken.json'),
      'do-not-expose-secret',
    );
    const broken = await runDoctor({ ...options });
    expect(broken.ok).toBe(false);
    expect(broken.checks.find((item) => item.id === 'credential')).toMatchObject({
      status: 'fail',
    });
    expect(JSON.stringify(broken)).not.toContain('do-not-expose-secret');
  });

  it('已有平台与显式 API 不一致时停止联网检查', async () => {
    const options = await environment();
    await writeV1Workspace(options.workspaceDir);
    const network = vi.fn();
    const report = await runDoctor({
      ...options,
      api: 'https://other.example.com/api/v1',
      online: true,
      fetch: network,
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((item) => item.id === 'platform')).toMatchObject({ status: 'fail' });
    expect(network).not.toHaveBeenCalled();
  });

  it('遵循支持的最低 Node 版本及代理前缀', () => {
    expect(supportedNode('v20.13.1')).toBe(false);
    expect(supportedNode('v20.19.0')).toBe(true);
    expect(supportedNode('v24.22.1')).toBe(true);
    expect(readinessUrl({ origin: 'https://mesh.example.com', apiBasePath: '/proxy/api/v1' })).toBe(
      'https://mesh.example.com/proxy/api/health/ready',
    );
  });
});
