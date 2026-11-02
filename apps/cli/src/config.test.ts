import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_SCHEMA_VERSION,
  configHome,
  loadWorkspace,
  parseWorkspaceConfig,
  resolvePlatform,
  saveWorkspace,
  workspaceConfigPath,
} from './config';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    profile: 'default',
    platform: { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' },
    projectId: PROJECT,
    roleKey: 'backend',
    repositoryId: null,
    host: 'codex',
    workflowDefinitionRevisionId: null,
  };
}

describe('workspace config', () => {
  it('接受固定 schemaVersion 字段集', () => {
    const parsed = parseWorkspaceConfig(validConfig());
    expect(parsed.platform).toEqual({
      origin: 'https://workmesh.example.com',
      apiBasePath: '/api/v1',
    });
    expect(parsed.roleKey).toBe('backend');
    expect(parsed.host).toBe('codex');
  });

  it.each(['apiUrl', 'role', 'specVersion', 'accessToken', 'refreshToken', 'password', 'token'])(
    '拒绝旧字段 %s，不回退旧格式',
    (key) => {
      const config = { ...validConfig(), [key]: 'legacy' };
      expect(() => parseWorkspaceConfig(config)).toThrow(/不再受支持|未知配置字段/);
    },
  );

  it('拒绝未知字段与错误 schemaVersion', () => {
    expect(() => parseWorkspaceConfig({ ...validConfig(), extra: true })).toThrow(/未知配置字段/);
    expect(() => parseWorkspaceConfig({ ...validConfig(), schemaVersion: '2.0' })).toThrow(
      /schemaVersion/,
    );
  });

  it('拒绝包含 query 的平台地址与非 loopback HTTP', () => {
    expect(() =>
      parseWorkspaceConfig({
        ...validConfig(),
        platform: { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1?x=1' },
      }),
    ).toThrow();
    expect(() =>
      parseWorkspaceConfig({
        ...validConfig(),
        platform: { origin: 'http://workmesh.example.com', apiBasePath: '/api/v1' },
      }),
    ).toThrow(/HTTPS/);
  });

  it('不存在时明确报 CONFIG_NOT_FOUND，不静默回退', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-config-'));
    await expect(loadWorkspace(dir)).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
  });

  it('坏 JSON 不 fallback 到默认平台', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-config-'));
    await mkdir(join(dir, '.workmesh'), { recursive: true });
    await writeFile(workspaceConfigPath(dir), '{ not json', 'utf8');
    await expect(loadWorkspace(dir)).rejects.toMatchObject({ code: 'CONFIG_SCHEMA_UNSUPPORTED' });
  });

  it('原子写入后可按原值读回，且不包含任何 token 字段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-config-'));
    const path = await saveWorkspace(dir, parseWorkspaceConfig(validConfig()));
    expect(path).toBe(workspaceConfigPath(dir));
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toMatch(/token|secret|password/i);
    const loaded = await loadWorkspace(dir);
    expect(loaded.projectId).toBe(PROJECT);
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
  });

  it('--config-home 必须是绝对路径，未显式时使用 WORKMESH_CONFIG_HOME', () => {
    const absolute = resolve('/tmp/wm-home');
    expect(configHome(absolute)).toBe(absolute);
    expect(() => configHome('relative')).toThrow(/绝对路径/);
  });

  it('平台必须来自显式 --api 或工作区配置', () => {
    expect(resolvePlatform(parseWorkspaceConfig(validConfig()), undefined).origin).toBe(
      'https://workmesh.example.com',
    );
    expect(resolvePlatform(undefined, 'http://127.0.0.1:3000/api/v1').origin).toBe(
      'http://127.0.0.1:3000',
    );
    expect(() => resolvePlatform(undefined, undefined)).toThrow(/缺少平台地址/);
  });
});
