import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@workmesh/shared';
import {
  collectDocumentReferences,
  isSafeSuggestedPath,
  normalizeWorkspaceDefinition,
  validateWorkspaceDefinitionPayload,
  workspaceDefinitionDigest,
  type WorkspaceDefinitionPayload,
} from './workspace-definition-validator';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REPO_A = '22222222-2222-4222-8222-222222222222';
const REPO_B = '33333333-3333-4333-8333-333333333333';
const DOC_A = '44444444-4444-4444-8444-444444444444';

function multiPayload(
  overrides: Partial<WorkspaceDefinitionPayload> = {},
): WorkspaceDefinitionPayload {
  return {
    schemaVersion: '1.0',
    projectId: PROJECT_ID,
    layout: { kind: 'MULTI_ROOT' },
    repositories: [
      {
        key: 'web',
        projectRepositoryId: REPO_A,
        suggestedPath: 'apps/web',
        defaultRef: 'main',
        description: null,
      },
      {
        key: 'api',
        projectRepositoryId: REPO_B,
        suggestedPath: 'services/api',
        defaultRef: null,
        description: null,
      },
    ],
    relations: [],
    roleHints: {},
    contextPolicy: {
      requiredDocumentIds: [],
      roleDocumentIds: {},
      repositoryDocuments: [],
    },
    ...overrides,
  };
}

function rawMulti(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...multiPayload(), ...overrides } as Record<string, unknown>;
}

function codesOf(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code);
}

describe('工作区定义规范化', () => {
  it('把可选字段展开为稳定形态（缺失 relations/roleHints/contextPolicy 也补全）', () => {
    const normalized = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId: PROJECT_ID,
        layout: { kind: 'MULTI_ROOT' },
        repositories: [
          {
            key: 'web',
            projectRepositoryId: REPO_A,
            suggestedPath: 'apps/web',
            defaultRef: 'main',
          },
          { key: 'api', projectRepositoryId: REPO_B, suggestedPath: 'services/api' },
        ],
      },
      PROJECT_ID,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.payload).toEqual(multiPayload());
  });

  it('SINGLE_ROOT 缺省 suggestedPath 补成 "."，digest 不随客户端省略漂移', () => {
    const a = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId: PROJECT_ID,
        layout: { kind: 'SINGLE_ROOT' },
        repositories: [{ key: 'app', projectRepositoryId: REPO_A }],
      },
      PROJECT_ID,
    );
    const b = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId: PROJECT_ID,
        layout: { kind: 'SINGLE_ROOT' },
        repositories: [{ key: 'app', projectRepositoryId: REPO_A, suggestedPath: '.' }],
      },
      PROJECT_ID,
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.payload).toEqual(b.payload);
    expect(workspaceDefinitionDigest(a.payload)).toBe(workspaceDefinitionDigest(b.payload));
  });

  it('拒绝未知字段、错误 schemaVersion、非法 UUID 与缺失 layout.kind', () => {
    const unknown = normalizeWorkspaceDefinition(rawMulti({ extra: true }), PROJECT_ID);
    expect(unknown.ok).toBe(false);
    expect(codesOf(unknown.issues)).toContain('UNKNOWN_FIELD');

    const workspacePush = normalizeWorkspaceDefinition(
      rawMulti({ schemaVersion: '2.0' }),
      PROJECT_ID,
    );
    expect(workspacePush.ok).toBe(false);
    expect(codesOf(workspacePush.issues)).toContain('SCHEMA_VERSION_INVALID');

    const badRepoId = normalizeWorkspaceDefinition(
      rawMulti({
        repositories: [
          { key: 'web', projectRepositoryId: 'not-a-uuid', suggestedPath: 'apps/web' },
          { key: 'api', projectRepositoryId: REPO_B, suggestedPath: 'services/api' },
        ],
      }),
      PROJECT_ID,
    );
    expect(badRepoId.ok).toBe(false);
    expect(codesOf(badRepoId.issues)).toContain('INVALID_UUID');

    const noKind = normalizeWorkspaceDefinition(rawMulti({ layout: {} }), PROJECT_ID);
    expect(noKind.ok).toBe(false);
    expect(codesOf(noKind.issues)).toContain('LAYOUT_KIND_INVALID');
  });

  it('projectId 必须与 URL 项目一致', () => {
    const result = normalizeWorkspaceDefinition(
      rawMulti({ projectId: '55555555-5555-4555-8555-555555555555' }),
      PROJECT_ID,
    );
    expect(result.ok).toBe(false);
    expect(codesOf(result.issues)).toContain('PROJECT_MISMATCH');
  });
});

describe('工作区定义语义校验：layout 规则', () => {
  it('layout.kind=NONE 要求 repositories 为空', () => {
    const none = multiPayload({ layout: { kind: 'NONE' } });
    expect(codesOf(validateWorkspaceDefinitionPayload(none))).toContain(
      'LAYOUT_REPOSITORIES_MISMATCH',
    );
    const empty = multiPayload({ layout: { kind: 'NONE' }, repositories: [] });
    expect(validateWorkspaceDefinitionPayload(empty)).toEqual([]);
  });

  it('SINGLE_ROOT 恰好一个仓库且路径为 .', () => {
    const one = multiPayload({
      layout: { kind: 'SINGLE_ROOT' },
      repositories: [
        {
          key: 'app',
          projectRepositoryId: REPO_A,
          suggestedPath: '.',
          defaultRef: null,
          description: null,
        },
      ],
    });
    expect(validateWorkspaceDefinitionPayload(one)).toEqual([]);

    const wrongPath = {
      ...one,
      repositories: [{ ...one.repositories[0]!, suggestedPath: 'app' }],
    };
    expect(codesOf(validateWorkspaceDefinitionPayload(wrongPath))).toContain(
      'SUGGESTED_PATH_INVALID',
    );

    const two = multiPayload({ layout: { kind: 'SINGLE_ROOT' } });
    expect(codesOf(validateWorkspaceDefinitionPayload(two))).toContain(
      'LAYOUT_REPOSITORIES_MISMATCH',
    );
  });

  it('MULTI_ROOT 至少两个仓库且每个都要安全相对路径', () => {
    const single = multiPayload({
      repositories: [multiPayload().repositories[0]!],
    });
    expect(codesOf(validateWorkspaceDefinitionPayload(single))).toContain(
      'LAYOUT_REPOSITORIES_MISMATCH',
    );

    for (const badPath of ['/abs', 'C:/drive', 'a/../b', 'a\\b', 'apps/web/']) {
      expect(isSafeSuggestedPath(badPath), badPath).toBe(false);
    }
    expect(isSafeSuggestedPath('apps/web')).toBe(true);
    expect(isSafeSuggestedPath('.')).toBe(true);
  });

  it('重复 key / 重复仓库 / 重复路径被发现', () => {
    const duplicated = multiPayload({
      repositories: [
        {
          key: 'web',
          projectRepositoryId: REPO_A,
          suggestedPath: 'a',
          defaultRef: null,
          description: null,
        },
        {
          key: 'web',
          projectRepositoryId: REPO_B,
          suggestedPath: 'a',
          defaultRef: null,
          description: null,
        },
      ],
    });
    expect(codesOf(validateWorkspaceDefinitionPayload(duplicated))).toEqual(
      expect.arrayContaining(['REPOSITORY_KEY_DUPLICATE', 'SUGGESTED_PATH_DUPLICATE']),
    );

    const sameRepository = multiPayload({
      repositories: [
        {
          key: 'web',
          projectRepositoryId: REPO_A,
          suggestedPath: 'a',
          defaultRef: null,
          description: null,
        },
        {
          key: 'api',
          projectRepositoryId: REPO_A,
          suggestedPath: 'b',
          defaultRef: null,
          description: null,
        },
      ],
    });
    expect(codesOf(validateWorkspaceDefinitionPayload(sameRepository))).toContain(
      'REPOSITORY_DUPLICATE',
    );
  });

  it('未声明的嵌套路径报错；显式 NESTED_IN 关系后合法', () => {
    const nested = multiPayload({
      repositories: [
        {
          key: 'mono',
          projectRepositoryId: REPO_A,
          suggestedPath: 'repo',
          defaultRef: null,
          description: null,
        },
        {
          key: 'lib',
          projectRepositoryId: REPO_B,
          suggestedPath: 'repo/libs/lib',
          defaultRef: null,
          description: null,
        },
      ],
    });
    expect(codesOf(validateWorkspaceDefinitionPayload(nested))).toContain('SUGGESTED_PATH_OVERLAP');

    const declared = {
      ...nested,
      relations: [
        { type: 'NESTED_IN' as const, repositoryKey: 'lib', parentRepositoryKey: 'mono' },
      ],
    };
    expect(validateWorkspaceDefinitionPayload(declared)).toEqual([]);
  });

  it('relations：未知仓库、自引用、重复子仓库、路径不在父仓下、循环都报错', () => {
    const base = multiPayload({
      repositories: [
        {
          key: 'a',
          projectRepositoryId: REPO_A,
          suggestedPath: 'a',
          defaultRef: null,
          description: null,
        },
        {
          key: 'b',
          projectRepositoryId: REPO_B,
          suggestedPath: 'b',
          defaultRef: null,
          description: null,
        },
      ],
    });
    const issues = validateWorkspaceDefinitionPayload({
      ...base,
      relations: [
        { type: 'SUBMODULE_OF', repositoryKey: 'a', parentRepositoryKey: 'b' },
        { type: 'NESTED_IN', repositoryKey: 'a', parentRepositoryKey: 'a' },
        { type: 'NESTED_IN', repositoryKey: 'ghost', parentRepositoryKey: 'b' },
      ],
    });
    expect(codesOf(issues)).toEqual(
      expect.arrayContaining([
        'RELATION_PATH_INVALID',
        'RELATION_SELF_REFERENCE',
        'RELATION_DUPLICATE_CHILD',
        'RELATION_REPOSITORY_UNKNOWN',
      ]),
    );

    const cycle = validateWorkspaceDefinitionPayload({
      ...base,
      repositories: [
        {
          key: 'a',
          projectRepositoryId: REPO_A,
          suggestedPath: 'a',
          defaultRef: null,
          description: null,
        },
        {
          key: 'b',
          projectRepositoryId: REPO_B,
          suggestedPath: 'a/b',
          defaultRef: null,
          description: null,
        },
      ],
      relations: [
        { type: 'NESTED_IN', repositoryKey: 'a', parentRepositoryKey: 'b' },
        { type: 'NESTED_IN', repositoryKey: 'b', parentRepositoryKey: 'a' },
      ],
    });
    expect(codesOf(cycle)).toContain('RELATION_CYCLE');
  });

  it('非 MULTI_ROOT 不允许 relations；roleHints 必须引用本定义的仓库 key', () => {
    const single = multiPayload({
      layout: { kind: 'SINGLE_ROOT' },
      repositories: [
        {
          key: 'app',
          projectRepositoryId: REPO_A,
          suggestedPath: '.',
          defaultRef: null,
          description: null,
        },
      ],
      relations: [{ type: 'NESTED_IN', repositoryKey: 'app', parentRepositoryKey: 'app' }],
      roleHints: { product: { recommendedRepositoryKeys: ['missing'] } },
    });
    expect(codesOf(validateWorkspaceDefinitionPayload(single))).toEqual(
      expect.arrayContaining(['RELATION_LAYOUT_INVALID', 'ROLE_HINT_REPOSITORY_UNKNOWN']),
    );
  });
});

describe('工作区定义 digest 与文档引用', () => {
  it('digest 只取决于规范化后的 payload：字段顺序无关、内容变化即变化', () => {
    const payload = multiPayload();
    const reordered = JSON.parse(
      JSON.stringify({
        contextPolicy: payload.contextPolicy,
        roleHints: payload.roleHints,
        relations: payload.relations,
        repositories: payload.repositories,
        layout: payload.layout,
        projectId: payload.projectId,
        schemaVersion: payload.schemaVersion,
      }),
    ) as WorkspaceDefinitionPayload;
    expect(workspaceDefinitionDigest(payload)).toMatch(/^[0-9a-f]{64}$/);
    expect(workspaceDefinitionDigest(reordered)).toBe(workspaceDefinitionDigest(payload));

    const changed = multiPayload({
      repositories: [
        { ...payload.repositories[0]!, suggestedPath: 'apps/other' },
        payload.repositories[1]!,
      ],
    });
    expect(workspaceDefinitionDigest(changed)).not.toBe(workspaceDefinitionDigest(payload));
    expect(workspaceDefinitionDigest(payload)).toBe(
      createHash('sha256')
        .update(Buffer.from(canonicalJson(payload), 'utf8'))
        .digest('hex'),
    );
  });

  it('收集 payload 内全部文档引用并保留 JSON 路径', () => {
    const payload = multiPayload({
      contextPolicy: {
        requiredDocumentIds: [DOC_A],
        roleDocumentIds: { product: [DOC_A] },
        repositoryDocuments: [{ repositoryKey: 'web', documentIds: [DOC_A] }],
      },
    });
    const references = collectDocumentReferences(payload);
    expect(references).toHaveLength(3);
    expect(references.map((reference) => reference.path)).toEqual([
      'contextPolicy.requiredDocumentIds[0]',
      'contextPolicy.roleDocumentIds.product[0]',
      'contextPolicy.repositoryDocuments[0].documentIds[0]',
    ]);
  });
});
