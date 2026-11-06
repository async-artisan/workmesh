import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '@workmesh/shared';
import { definitionCacheChecksum, parseDefinitionRepositories } from './workspace-config';

export const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
export const PROJECT_B = '3f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4c';
export const WORKSPACE = '11111111-1111-4111-8111-111111111111';
export const WORKSPACE_B = '55555555-5555-4555-8555-555555555555';
export const REVISION = '22222222-2222-4222-8222-222222222222';
export const REVISION_B = '99999999-9999-4999-8999-999999999999';
export const REPOSITORY = '33333333-3333-4333-8333-333333333333';
export const REPOSITORY_B = '44444444-4444-4444-8444-444444444444';
export const CREDENTIAL = '66666666-6666-4666-8666-666666666666';
export const USER_ID = '77777777-7777-4777-8777-777777777777';
export const ROLE_ID = '88888888-8888-4888-8888-888888888888';
export const ROLE = 'backend';
export const PLATFORM = { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' };
export const API = 'https://workmesh.example.com/api/v1';
export const DEFAULT_LOCATOR = 'https://workmesh.example.com/acme/web.git';

export function makeCredential(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.0',
    origin: PLATFORM.origin,
    apiBasePath: PLATFORM.apiBasePath,
    userId: USER_ID,
    credentialId: CREDENTIAL,
    secret: 's'.repeat(43),
    projectId: PROJECT,
    roleId: ROLE_ID,
    roleKey: ROLE,
    scopes: ['task:read', 'context:read'],
    createdAt: '2026-11-05T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export async function makeTempDir(prefix = 'wm-wsc-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeV1Workspace(
  dir: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {
    schemaVersion: '1.0' as const,
    profile: 'default',
    platform: PLATFORM,
    projectId: PROJECT,
    roleKey: ROLE,
    repositoryId: null,
    host: 'codex',
    workflowDefinitionRevisionId: null,
    ...overrides,
  };
  await mkdir(join(dir, '.workmesh'), { recursive: true });
  await writeFile(
    join(dir, '.workmesh', 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  return config;
}

export type V2WorkspaceOptions = {
  workspaceId?: string;
  projectId?: string;
  definition?: { revisionId: string; sha256: string } | null;
  layoutKind?: 'SINGLE_ROOT' | 'MULTI_ROOT' | 'NONE';
  repositories?: Array<{
    key: string;
    projectRepositoryId: string;
    path: string;
    remote?: string;
    needsRevalidation?: boolean;
  }>;
  roleKey?: string | null;
  platform?: { origin: string; apiBasePath: string };
  host?: 'codex' | 'claude-code';
};

export function v2Config(options: V2WorkspaceOptions = {}): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    workspaceId: options.workspaceId ?? WORKSPACE,
    platform: options.platform ?? PLATFORM,
    projectId: options.projectId ?? PROJECT,
    definition:
      options.definition === undefined
        ? { revisionId: REVISION, sha256: 'a'.repeat(64) }
        : options.definition,
    layout: { kind: options.layoutKind ?? 'NONE' },
    repositories: (options.repositories ?? []).map((repository) => ({
      key: repository.key,
      projectRepositoryId: repository.projectRepositoryId,
      path: repository.path,
      remote: repository.remote ?? 'origin',
      ...(repository.needsRevalidation ? { needsRevalidation: true } : {}),
    })),
    defaults: {
      profile: 'default',
      host: options.host ?? 'codex',
      roleKey: options.roleKey === undefined ? ROLE : options.roleKey,
    },
  };
}

export async function writeV2Workspace(
  dir: string,
  options: V2WorkspaceOptions = {},
): Promise<Record<string, unknown>> {
  const config = v2Config(options);
  await mkdir(join(dir, '.workmesh'), { recursive: true });
  await writeFile(
    join(dir, '.workmesh', 'workspace.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  return config;
}

/** 制造合法 MIGRATED 状态：仅保留 v2 + 已归档的 .bak（v1 活动文件不存在）。 */
export async function markMigrated(
  dir: string,
  v1Overrides: Record<string, unknown> = {},
): Promise<void> {
  await writeV1Workspace(dir, v1Overrides);
  const { rename } = await import('node:fs/promises');
  await rename(
    join(dir, '.workmesh', 'config.json'),
    join(dir, '.workmesh', 'config.v1.20261105T120000000Z.json.bak'),
  );
}

export type RepoFixtureInput = {
  key?: string;
  projectRepositoryId?: string;
  suggestedPath?: string | null;
  locators?: Array<[string, 'HTTPS' | 'SSH']>;
  identityMode?: 'DECLARED' | 'PROVIDER';
  provider?: { adapter: string; externalId: string } | null;
  archivedAt?: string | null;
};

export type DefinitionFixture = {
  revisionId: string;
  digest: string;
  payload: Record<string, unknown>;
  revisionData: Record<string, unknown>;
  definitionRef: { revisionId: string; sha256: string };
};

/** 构造与服务端 T3 契约一致的 revision 响应 data 与规范化 digest。 */
export async function makeDefinitionFixture(
  options: {
    revisionId?: string;
    projectId?: string;
    layoutKind?: 'SINGLE_ROOT' | 'MULTI_ROOT' | 'NONE';
    repositories?: RepoFixtureInput[];
  } = {},
): Promise<DefinitionFixture> {
  const revisionId = options.revisionId ?? REVISION;
  const projectId = options.projectId ?? PROJECT;
  const layoutKind = options.layoutKind ?? 'NONE';
  const repositories = options.repositories ?? [];
  const payload = {
    schemaVersion: '1.0' as const,
    projectId,
    layout: { kind: layoutKind },
    repositories: repositories.map((repository, index) => ({
      key: repository.key ?? `repo-${index + 1}`,
      projectRepositoryId: repository.projectRepositoryId ?? REPOSITORY,
      suggestedPath: repository.suggestedPath === undefined ? '.' : repository.suggestedPath,
      defaultRef: null,
      description: null,
    })),
    relations: [],
    roleHints: {},
    contextPolicy: {
      requiredDocumentIds: [],
      roleDocumentIds: {},
      repositoryDocuments: [],
    },
  };
  const digest = createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
  const revisionData = {
    revisionId,
    revisionNo: 1,
    digest,
    payload,
    publishedAt: '2026-11-05T00:00:00.000Z',
    publishedByUserId: null,
    repositories: repositories.map((repository, index) => ({
      key: repository.key ?? `repo-${index + 1}`,
      projectRepositoryId: repository.projectRepositoryId ?? REPOSITORY,
      suggestedPath: repository.suggestedPath === undefined ? '.' : repository.suggestedPath,
      defaultRef: null,
      description: null,
      identityMode: repository.identityMode ?? 'DECLARED',
      adapter:
        repository.identityMode === 'PROVIDER' ? (repository.provider?.adapter ?? 'github') : null,
      externalId:
        repository.identityMode === 'PROVIDER'
          ? (repository.provider?.externalId ?? 'ext-1')
          : null,
      owner: 'acme',
      name: repository.key ?? `repo-${index + 1}`,
      archivedAt: repository.archivedAt ?? null,
      provider: repository.provider ?? null,
      locators: (repository.locators ?? [[DEFAULT_LOCATOR, 'HTTPS']]).map(
        ([canonicalLocator, source]) => ({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          canonicalLocator,
          source,
          declaredAt: '2026-11-05T00:00:00.000Z',
        }),
      ),
    })),
    definitionVersion: 2,
    projectVersion: 3,
    validation: { valid: true, issues: [] },
  };
  return {
    revisionId,
    digest,
    payload,
    revisionData,
    definitionRef: { revisionId, sha256: digest },
  };
}

export async function writeDefinitionCache(
  dir: string,
  fixture: DefinitionFixture,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const cache = {
    schemaVersion: '1.0' as const,
    revisionId: fixture.revisionId,
    digest: fixture.digest,
    fetchedAt: '2026-11-05T00:00:00.000Z',
    publishedAt: '2026-11-05T00:00:00.000Z',
    payload: fixture.payload,
    repositories: parseDefinitionRepositories(fixture.revisionData.repositories),
    validation: { valid: true, issues: [] },
    ...overrides,
  };
  const snapshotChecksum = await definitionCacheChecksum(cache);
  const path = join(dir, '.workmesh', 'definitions', `${fixture.revisionId}.json`);
  await mkdir(join(dir, '.workmesh', 'definitions'), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...cache, snapshotChecksum }, null, 2)}\n`, 'utf8');
}

/** 目录树指纹：用于断言 dry-run / discover / status 零写入。 */
export async function snapshotTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const label = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        lines.push(`d:${label}`);
        await walk(path, label);
      } else {
        const bytes = await readFile(path);
        lines.push(`f:${label}:${createHash('sha256').update(bytes).digest('hex')}`);
      }
    }
  }
  await walk(root, '');
  return lines;
}

export async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function fileMode(path: string): Promise<number> {
  return (await stat(path)).mode;
}
