import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  buildSoftwareDeliveryWorkflowTemplate,
  canonicalJson,
  compileWorkflowDefinition,
  sha256Bytes,
  validateRolePackage,
} from '@workmesh/shared';
import { BUILTIN_ROLE_PACKAGES } from './index';

/** 与 `DEFAULT_PROJECT_ROLES` 一致：内置包必须能直接对上项目创建时预置的角色。 */
const DEFAULT_ROLE_KEYS = ['backend', 'frontend', 'ops', 'product', 'qa', 'ui'];

describe('builtin role packages', () => {
  it('embeds the current source resources and metadata, not a stale generated copy', async () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      const meta = JSON.parse(
        await readFile(
          new URL(`../roles/${item.roleKey}/package.meta.json`, import.meta.url),
          'utf8',
        ),
      );
      expect(item.version).toBe(meta.version);
      expect(item.manifest.skills).toEqual(meta.skills);
      await Promise.all(
        item.resources.map(async (resource) => {
          const bytes = await readFile(new URL(`../${resource.path}`, import.meta.url));
          expect(bytes.toString('base64'), resource.path).toBe(resource.bodyBase64);
        }),
      );
    }
  });
  it('supports the software template with the actual package contracts and separate execution evidence', async () => {
    const packageLocks = await Promise.all(
      BUILTIN_ROLE_PACKAGES.map(async (item) => ({
        roleKey: item.roleKey,
        packageId: item.packageId,
        version: item.version,
        packageDigest: await sha256Bytes(new TextEncoder().encode(canonicalJson(item.manifest))),
      })),
    );
    const result = await compileWorkflowDefinition(buildSoftwareDeliveryWorkflowTemplate(), {
      roleIdsByKey: Object.fromEntries(DEFAULT_ROLE_KEYS.map((key) => [key, `role-${key}`])),
      packageLocks,
      packageContracts: BUILTIN_ROLE_PACKAGES.map((item) => item.manifest),
    });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    const qa = BUILTIN_ROLE_PACKAGES.find((item) => item.roleKey === 'qa')!;
    const resourceText = (suffix: string) =>
      Buffer.from(
        qa.resources.find((resource) => resource.path.endsWith(suffix))!.bodyBase64,
        'base64',
      ).toString('utf8');
    expect(resourceText('/cases.yaml')).toContain('executionStatus: NOT_RUN');
    expect(resourceText('/evals.yaml')).toContain('casesRevision:');
  });

  it('ships exactly one package per default project role', () => {
    const keys = BUILTIN_ROLE_PACKAGES.map((item) => item.roleKey).sort();
    expect(keys).toEqual(DEFAULT_ROLE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of BUILTIN_ROLE_PACKAGES) {
      expect(item.manifest.roleKey).toBe(item.roleKey);
      expect(item.packageId).toBe(item.manifest.id);
      expect(item.version).toBe(item.manifest.version);
    }
  });

  it('every manifest passes the strict role package schema', () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      const result = validateRolePackage(item.manifest);
      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('declared resource digests and lengths match the embedded bytes', async () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      expect(item.resources.length).toBeGreaterThan(0);
      for (const resource of item.resources) {
        const declared = item.manifest.resources.find((entry) => entry.id === resource.resourceId);
        expect(declared).toBeDefined();
        const bytes = Buffer.from(resource.bodyBase64, 'base64');
        expect(bytes.byteLength).toBe(declared?.byteLength);
        expect(bytes.byteLength).toBe(resource.byteLength);
        expect(await sha256Bytes(new Uint8Array(bytes))).toBe(declared?.sha256);
        // CLI manifest 的路径相对 roles/<role>/；generated 保留完整路径供服务端定位。
        expect(declared?.path).toBe(resource.path.replace(`roles/${item.roleKey}/`, ''));
      }
    }
  });

  it('every resource lives under its role directory and carries real bytes', () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      const paths = item.resources.map((resource) => resource.path);
      expect(paths).toContain(`roles/${item.roleKey}/guide.md`);
      expect(paths.some((path) => path.includes('/skills/'))).toBe(true);
      for (const resource of item.resources) {
        expect(resource.byteLength).toBeGreaterThan(0);
        expect(resource.path.startsWith(`roles/${item.roleKey}/`)).toBe(true);
        if (resource.path.endsWith('.md')) expect(resource.mediaType).toBe('text/markdown');
      }
      const declared = new Set(item.manifest.resources.map((resource) => resource.id));
      expect(declared.size).toBe(item.manifest.resources.length);
    }
  });

  it('manifestDigest is the canonical JSON digest the server will recompute', async () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      const digest = await sha256Bytes(new TextEncoder().encode(canonicalJson(item.manifest)));
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      // 同一份 manifest 反复计算必须稳定；服务端编译据此比对角色包锁。
      expect(await sha256Bytes(new TextEncoder().encode(canonicalJson(item.manifest)))).toBe(
        digest,
      );
    }
  });

  it('agent entries only reference declared resources for both supported hosts', () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      const resourceIds = new Set(item.manifest.resources.map((resource) => resource.id));
      const hosts = item.manifest.agentEntries.map((entry) => entry.host).sort();
      expect(hosts).toEqual(['claude-code', 'codex']);
      for (const entry of item.manifest.agentEntries)
        expect(resourceIds.has(entry.resourceId)).toBe(true);
    }
  });

  it('does not tell agents to use nonexistent CLI commands', () => {
    for (const item of BUILTIN_ROLE_PACKAGES) {
      for (const resource of item.resources) {
        const text = Buffer.from(resource.bodyBase64, 'base64').toString('utf8');
        // 旧设计里的 ready / sign / sync 已从 CLI 移除；SOP 不得再指导执行。
        expect(text).not.toMatch(/workmesh\s+(ready|sign|sync)\b/);
      }
    }
  });
});
