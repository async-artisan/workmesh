import { createHash } from 'node:crypto';
import { canonicalJson } from '@workmesh/shared';

/**
 * 平台工作区定义的规范化与校验（纯函数，不访问数据库）。
 *
 * 两类问题分开处理：
 * - 规范化（`normalizeWorkspaceDefinition`）只处理结构与字段类型，决定“客户端不能声明未知字段、
 *   服务端必须能给出唯一 JSON 形态”，也是 digest 的输入；
 * - 语义校验（`validateWorkspaceDefinitionPayload`）检查 layout 规则、仓库 key 唯一性、
 *   suggestedPath 越界与 relations 等业务约束。
 *
 * 草稿保存只要求可规范化（允许 WIP 的不完整内容）；validate/publish 才要求语义合法。
 */

export type WorkspaceLayoutKind = 'SINGLE_ROOT' | 'MULTI_ROOT' | 'NONE';

export type WorkspaceDefinitionRepositoryEntry = {
  key: string;
  projectRepositoryId: string;
  suggestedPath: string | null;
  defaultRef: string | null;
  description: string | null;
};

export type WorkspaceDefinitionRelation = {
  type: 'SUBMODULE_OF' | 'NESTED_IN';
  repositoryKey: string;
  parentRepositoryKey: string;
};

export type WorkspaceDefinitionPayload = {
  schemaVersion: '1.0';
  projectId: string;
  layout: { kind: WorkspaceLayoutKind };
  repositories: WorkspaceDefinitionRepositoryEntry[];
  relations: WorkspaceDefinitionRelation[];
  roleHints: Record<string, { recommendedRepositoryKeys: string[] }>;
  contextPolicy: {
    requiredDocumentIds: string[];
    roleDocumentIds: Record<string, string[]>;
    repositoryDocuments: Array<{ repositoryKey: string; documentIds: string[] }>;
  };
};

export type WorkspaceDefinitionIssue = { path: string; code: string; message: string };

export type NormalizeWorkspaceDefinitionResult =
  | { ok: true; payload: WorkspaceDefinitionPayload; issues: WorkspaceDefinitionIssue[] }
  | { ok: false; payload: null; issues: WorkspaceDefinitionIssue[] };

const LAYOUT_KINDS: readonly WorkspaceLayoutKind[] = ['SINGLE_ROOT', 'MULTI_ROOT', 'NONE'];
const RELATION_TYPES = ['SUBMODULE_OF', 'NESTED_IN'] as const;
const REPOSITORY_KEY = /^[a-z][a-z0-9-]{0,47}$/;
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'layout',
  'repositories',
  'relations',
  'roleHints',
  'contextPolicy',
]);
const REPOSITORY_KEYS = new Set([
  'key',
  'projectRepositoryId',
  'suggestedPath',
  'defaultRef',
  'description',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(
  issues: WorkspaceDefinitionIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function stringField(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
  path: string,
  options: { max?: number; required?: boolean } = {},
): string | null {
  if (value === undefined || value === null) {
    if (options.required) issue(issues, path, 'FIELD_REQUIRED', '字段不能为空');
    return null;
  }
  if (typeof value !== 'string') {
    issue(issues, path, 'INVALID_TYPE', '字段必须是字符串');
    return null;
  }
  const trimmed = value;
  if (trimmed.length === 0) {
    issue(issues, path, 'FIELD_REQUIRED', '字段不能为空');
    return null;
  }
  if (options.max !== undefined && trimmed.length > options.max) {
    issue(issues, path, 'FIELD_TOO_LONG', `字段长度不能超过 ${options.max}`);
    return null;
  }
  return trimmed;
}

function uuidField(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
  path: string,
): string | null {
  if (typeof value !== 'string' || !UUID_SHAPE.test(value)) {
    issue(issues, path, 'INVALID_UUID', '必须是 UUID');
    return null;
  }
  return value;
}

function stringArray(issues: WorkspaceDefinitionIssue[], value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issue(issues, path, 'INVALID_TYPE', '必须是数组');
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    const text = stringField(issues, item, `${path}[${index}]`, { max: 500 });
    if (text !== null) result.push(text);
  });
  return result;
}

function uuidArray(issues: WorkspaceDefinitionIssue[], value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issue(issues, path, 'INVALID_TYPE', '必须是数组');
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    const uuid = uuidField(issues, item, `${path}[${index}]`);
    if (uuid !== null) result.push(uuid);
  });
  return result;
}

function normalizeLayout(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
): { kind: WorkspaceLayoutKind } | null {
  if (!isRecord(value)) {
    issue(issues, 'layout', 'FIELD_REQUIRED', 'layout 必须是对象');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'kind') issue(issues, `layout.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !(LAYOUT_KINDS as readonly string[]).includes(kind)) {
    issue(
      issues,
      'layout.kind',
      'LAYOUT_KIND_INVALID',
      'layout.kind 必须是 SINGLE_ROOT/MULTI_ROOT/NONE',
    );
    return null;
  }
  return { kind: kind as WorkspaceLayoutKind };
}

function normalizeRepositories(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
  kind: WorkspaceLayoutKind | null,
): WorkspaceDefinitionRepositoryEntry[] {
  if (value === undefined || value === null) {
    issue(issues, 'repositories', 'FIELD_REQUIRED', 'repositories 必须是数组');
    return [];
  }
  if (!Array.isArray(value)) {
    issue(issues, 'repositories', 'INVALID_TYPE', 'repositories 必须是数组');
    return [];
  }
  return value.map((item, index) => {
    const path = `repositories[${index}]`;
    if (!isRecord(item)) {
      issue(issues, path, 'INVALID_TYPE', '仓库条目必须是对象');
      return {
        key: '',
        projectRepositoryId: '',
        suggestedPath: null,
        defaultRef: null,
        description: null,
      };
    }
    for (const key of Object.keys(item)) {
      if (!REPOSITORY_KEYS.has(key))
        issue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
    }
    const key = stringField(issues, item.key, `${path}.key`, { required: true, max: 48 }) ?? '';
    if (key.length > 0 && !REPOSITORY_KEY.test(key))
      issue(issues, `${path}.key`, 'REPOSITORY_KEY_INVALID', 'key 必须是小写稳定逻辑键');
    const projectRepositoryId =
      uuidField(issues, item.projectRepositoryId, `${path}.projectRepositoryId`) ?? '';
    let suggestedPath = stringField(issues, item.suggestedPath, `${path}.suggestedPath`, {
      max: 500,
    });
    // SINGLE_ROOT 的根路径固定为 '.'；缺省时由服务端补齐，避免 digest 随客户端省略而漂移。
    if (suggestedPath === null && kind === 'SINGLE_ROOT' && value.length === 1) suggestedPath = '.';
    return {
      key,
      projectRepositoryId,
      suggestedPath,
      defaultRef: stringField(issues, item.defaultRef, `${path}.defaultRef`, { max: 200 }),
      description: stringField(issues, item.description, `${path}.description`, { max: 1000 }),
    };
  });
}

function normalizeRelations(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
): WorkspaceDefinitionRelation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issue(issues, 'relations', 'INVALID_TYPE', 'relations 必须是数组');
    return [];
  }
  return value.map((item, index) => {
    const path = `relations[${index}]`;
    if (!isRecord(item)) {
      issue(issues, path, 'INVALID_TYPE', '关系条目必须是对象');
      return { type: 'SUBMODULE_OF', repositoryKey: '', parentRepositoryKey: '' };
    }
    for (const key of Object.keys(item)) {
      if (!['type', 'repositoryKey', 'parentRepositoryKey'].includes(key))
        issue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
    }
    const type = item.type;
    if (typeof type !== 'string' || !(RELATION_TYPES as readonly string[]).includes(type))
      issue(issues, `${path}.type`, 'RELATION_TYPE_INVALID', '不支持的关系类型');
    return {
      type: (RELATION_TYPES as readonly string[]).includes(type as string)
        ? (type as WorkspaceDefinitionRelation['type'])
        : 'SUBMODULE_OF',
      repositoryKey:
        stringField(issues, item.repositoryKey, `${path}.repositoryKey`, {
          required: true,
          max: 48,
        }) ?? '',
      parentRepositoryKey:
        stringField(issues, item.parentRepositoryKey, `${path}.parentRepositoryKey`, {
          required: true,
          max: 48,
        }) ?? '',
    };
  });
}

function normalizeRoleHints(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
): Record<string, { recommendedRepositoryKeys: string[] }> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    issue(issues, 'roleHints', 'INVALID_TYPE', 'roleHints 必须是对象');
    return {};
  }
  const result: Record<string, { recommendedRepositoryKeys: string[] }> = {};
  for (const [roleKey, hint] of Object.entries(value)) {
    const path = `roleHints.${roleKey}`;
    if (!REPOSITORY_KEY.test(roleKey))
      issue(issues, path, 'ROLE_KEY_INVALID', '角色 key 必须是小写稳定键');
    if (!isRecord(hint)) {
      issue(issues, path, 'INVALID_TYPE', '角色提示必须是对象');
      continue;
    }
    for (const key of Object.keys(hint)) {
      if (key !== 'recommendedRepositoryKeys')
        issue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
    }
    result[roleKey] = {
      recommendedRepositoryKeys: stringArray(
        issues,
        hint.recommendedRepositoryKeys,
        `${path}.recommendedRepositoryKeys`,
      ),
    };
  }
  return result;
}

function normalizeContextPolicy(
  issues: WorkspaceDefinitionIssue[],
  value: unknown,
): WorkspaceDefinitionPayload['contextPolicy'] {
  const result: WorkspaceDefinitionPayload['contextPolicy'] = {
    requiredDocumentIds: [],
    roleDocumentIds: {},
    repositoryDocuments: [],
  };
  if (value === undefined || value === null) return result;
  if (!isRecord(value)) {
    issue(issues, 'contextPolicy', 'INVALID_TYPE', 'contextPolicy 必须是对象');
    return result;
  }
  for (const key of Object.keys(value)) {
    if (!['requiredDocumentIds', 'roleDocumentIds', 'repositoryDocuments'].includes(key))
      issue(issues, `contextPolicy.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
  }
  result.requiredDocumentIds = uuidArray(
    issues,
    value.requiredDocumentIds,
    'contextPolicy.requiredDocumentIds',
  );
  if (value.roleDocumentIds !== undefined && value.roleDocumentIds !== null) {
    if (!isRecord(value.roleDocumentIds))
      issue(issues, 'contextPolicy.roleDocumentIds', 'INVALID_TYPE', 'roleDocumentIds 必须是对象');
    else
      for (const [roleKey, ids] of Object.entries(value.roleDocumentIds)) {
        if (!REPOSITORY_KEY.test(roleKey))
          issue(
            issues,
            `contextPolicy.roleDocumentIds.${roleKey}`,
            'ROLE_KEY_INVALID',
            '角色 key 必须是小写稳定键',
          );
        result.roleDocumentIds[roleKey] = uuidArray(
          issues,
          ids,
          `contextPolicy.roleDocumentIds.${roleKey}`,
        );
      }
  }
  if (value.repositoryDocuments !== undefined && value.repositoryDocuments !== null) {
    if (!Array.isArray(value.repositoryDocuments))
      issue(
        issues,
        'contextPolicy.repositoryDocuments',
        'INVALID_TYPE',
        'repositoryDocuments 必须是数组',
      );
    else
      result.repositoryDocuments = value.repositoryDocuments.map((item, index) => {
        const path = `contextPolicy.repositoryDocuments[${index}]`;
        if (!isRecord(item)) {
          issue(issues, path, 'INVALID_TYPE', '条目必须是对象');
          return { repositoryKey: '', documentIds: [] };
        }
        for (const key of Object.keys(item)) {
          if (!['repositoryKey', 'documentIds'].includes(key))
            issue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', '不支持的字段');
        }
        return {
          repositoryKey:
            stringField(issues, item.repositoryKey, `${path}.repositoryKey`, {
              required: true,
              max: 48,
            }) ?? '',
          documentIds: uuidArray(issues, item.documentIds, `${path}.documentIds`),
        };
      });
  }
  return result;
}

/** 结构规范化；未知字段、类型错误与缺失必填字段一律作为 issue 返回。 */
export function normalizeWorkspaceDefinition(
  input: unknown,
  projectId: string,
): NormalizeWorkspaceDefinitionResult {
  const issues: WorkspaceDefinitionIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      payload: null,
      issues: [{ path: '$', code: 'INVALID_TYPE', message: '定义必须是对象' }],
    };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) issue(issues, key, 'UNKNOWN_FIELD', '不支持的字段');
  }
  if (input.schemaVersion !== '1.0')
    issue(issues, 'schemaVersion', 'SCHEMA_VERSION_INVALID', 'schemaVersion 必须是 "1.0"');
  const payloadProjectId = input.projectId;
  if (payloadProjectId !== undefined && payloadProjectId !== projectId)
    issue(issues, 'projectId', 'PROJECT_MISMATCH', 'projectId 必须与 URL 中的项目一致');
  const layout = normalizeLayout(issues, input.layout);
  const repositories = normalizeRepositories(issues, input.repositories, layout?.kind ?? null);
  const relations = normalizeRelations(issues, input.relations);
  const roleHints = normalizeRoleHints(issues, input.roleHints);
  const contextPolicy = normalizeContextPolicy(issues, input.contextPolicy);

  if (issues.length > 0) return { ok: false, payload: null, issues };
  return {
    ok: true,
    issues: [],
    payload: {
      schemaVersion: '1.0',
      projectId,
      layout: layout!,
      repositories,
      relations,
      roleHints,
      contextPolicy,
    },
  };
}

/** 相对 POSIX 路径安全：禁止绝对路径、盘符、`..`、空段与反斜杠。 */
export function isSafeSuggestedPath(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  if (value === '.') return true;
  if (value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  // Control characters are explicitly rejected as unsafe path content.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function isInsidePath(child: string, parent: string): boolean {
  return child !== parent && child.startsWith(`${parent}/`);
}

/** 语义校验：layout 规则、key/路径/仓库唯一性、relations 拓扑与 hint 引用。 */
export function validateWorkspaceDefinitionPayload(
  payload: WorkspaceDefinitionPayload,
): WorkspaceDefinitionIssue[] {
  const issues: WorkspaceDefinitionIssue[] = [];
  const repositories = payload.repositories;

  if (payload.layout.kind === 'NONE') {
    if (repositories.length > 0)
      issue(
        issues,
        'repositories',
        'LAYOUT_REPOSITORIES_MISMATCH',
        'layout.kind=NONE 时 repositories 必须为空',
      );
  } else if (payload.layout.kind === 'SINGLE_ROOT') {
    if (repositories.length !== 1)
      issue(
        issues,
        'repositories',
        'LAYOUT_REPOSITORIES_MISMATCH',
        'layout.kind=SINGLE_ROOT 时必须恰好有一个仓库',
      );
    if (repositories.length === 1 && repositories[0]!.suggestedPath !== '.')
      issue(
        issues,
        'repositories[0].suggestedPath',
        'SUGGESTED_PATH_INVALID',
        'layout.kind=SINGLE_ROOT 时根路径必须是 "."',
      );
  } else if (repositories.length < 2) {
    issue(
      issues,
      'repositories',
      'LAYOUT_REPOSITORIES_MISMATCH',
      'layout.kind=MULTI_ROOT 时至少有两个仓库',
    );
  }

  const keys = new Set<string>();
  const repositoryIds = new Set<string>();
  const pathsByKey = new Map<string, string>();
  repositories.forEach((repository, index) => {
    const path = `repositories[${index}]`;
    if (repository.key.length > 0) {
      if (keys.has(repository.key))
        issue(issues, `${path}.key`, 'REPOSITORY_KEY_DUPLICATE', '仓库 key 在定义内必须唯一');
      keys.add(repository.key);
    }
    if (repository.projectRepositoryId.length > 0) {
      if (repositoryIds.has(repository.projectRepositoryId))
        issue(
          issues,
          `${path}.projectRepositoryId`,
          'REPOSITORY_DUPLICATE',
          '同一 revision 不能重复登记同一仓库',
        );
      repositoryIds.add(repository.projectRepositoryId);
    }
    if (payload.layout.kind === 'MULTI_ROOT') {
      if (repository.suggestedPath === null)
        issue(
          issues,
          `${path}.suggestedPath`,
          'SUGGESTED_PATH_REQUIRED',
          '多仓定义必须声明 suggestedPath',
        );
      else if (!isSafeSuggestedPath(repository.suggestedPath))
        issue(
          issues,
          `${path}.suggestedPath`,
          'SUGGESTED_PATH_INVALID',
          'suggestedPath 必须是安全的相对 POSIX 路径（禁止绝对路径、盘符、.. 与反斜杠）',
        );
    }
    if (repository.suggestedPath !== null && repository.suggestedPath !== '.')
      pathsByKey.set(repository.key, repository.suggestedPath);
  });

  // 嵌套路径必须由显式 relations 说明；未声明的重叠是定义错误。
  const declaredPairs = new Set(
    payload.relations.map(
      (relation) => `${relation.repositoryKey}<-${relation.parentRepositoryKey}`,
    ),
  );
  const pathEntries = repositories
    .map((repository, index) => ({
      key: repository.key,
      index,
      path: repository.suggestedPath,
    }))
    .filter(
      (entry): entry is { key: string; index: number; path: string } =>
        entry.path !== null && entry.path !== '.',
    );
  for (let i = 0; i < pathEntries.length; i += 1) {
    for (let j = 0; j < pathEntries.length; j += 1) {
      if (i === j) continue;
      const child = pathEntries[i]!;
      const parent = pathEntries[j]!;
      if (!isInsidePath(child.path, parent.path)) continue;
      if (declaredPairs.has(`${child.key}<-${parent.key}`)) continue;
      issue(
        issues,
        `repositories[${child.index}].suggestedPath`,
        'SUGGESTED_PATH_OVERLAP',
        '嵌套路径必须有显式的 NESTED_IN/SUBMODULE_OF 关系声明',
      );
    }
  }

  const duplicatePaths = new Map<string, string>();
  for (const entry of pathEntries) {
    const previous = duplicatePaths.get(entry.path);
    if (previous !== undefined)
      issue(
        issues,
        'repositories',
        'SUGGESTED_PATH_DUPLICATE',
        `仓库 ${previous} 与 ${entry.key} 使用了相同的 suggestedPath`,
      );
    else duplicatePaths.set(entry.path, entry.key);
  }

  if (payload.layout.kind !== 'MULTI_ROOT' && payload.relations.length > 0)
    issue(issues, 'relations', 'RELATION_LAYOUT_INVALID', '关系只适用于 MULTI_ROOT');

  const parents = new Map<string, string>();
  const seenChildren = new Set<string>();
  payload.relations.forEach((relation, index) => {
    const path = `relations[${index}]`;
    const knownChild = keys.has(relation.repositoryKey);
    const knownParent = keys.has(relation.parentRepositoryKey);
    if (!knownChild)
      issue(
        issues,
        `${path}.repositoryKey`,
        'RELATION_REPOSITORY_UNKNOWN',
        '关系引用了不存在的仓库 key',
      );
    if (!knownParent)
      issue(
        issues,
        `${path}.parentRepositoryKey`,
        'RELATION_REPOSITORY_UNKNOWN',
        '关系引用了不存在的父仓库 key',
      );
    if (relation.repositoryKey === relation.parentRepositoryKey)
      issue(issues, `${path}`, 'RELATION_SELF_REFERENCE', '仓库不能与自身建立父子关系');
    if (seenChildren.has(relation.repositoryKey))
      issue(issues, `${path}`, 'RELATION_DUPLICATE_CHILD', '同一子仓库只能声明一个父仓库');
    seenChildren.add(relation.repositoryKey);
    parents.set(relation.repositoryKey, relation.parentRepositoryKey);
    const childPath = pathsByKey.get(relation.repositoryKey);
    const parentPath = pathsByKey.get(relation.parentRepositoryKey);
    if (
      knownChild &&
      knownParent &&
      childPath &&
      parentPath &&
      !isInsidePath(childPath, parentPath)
    )
      issue(
        issues,
        `${path}`,
        'RELATION_PATH_INVALID',
        '子仓库路径必须位于父仓库 suggestedPath 之下',
      );
  });
  for (const start of parents.keys()) {
    let current: string | undefined = start;
    const visited = new Set<string>();
    while (current !== undefined) {
      if (visited.has(current)) {
        issue(issues, 'relations', 'RELATION_CYCLE', '关系存在循环');
        break;
      }
      visited.add(current);
      current = parents.get(current);
    }
  }

  for (const [roleKey, hint] of Object.entries(payload.roleHints)) {
    for (const repositoryKey of hint.recommendedRepositoryKeys) {
      if (!keys.has(repositoryKey))
        issue(
          issues,
          `roleHints.${roleKey}.recommendedRepositoryKeys`,
          'ROLE_HINT_REPOSITORY_UNKNOWN',
          '推荐仓库 key 不在本定义的 repositories 中',
        );
    }
  }
  payload.contextPolicy.repositoryDocuments.forEach((entry, index) => {
    if (!keys.has(entry.repositoryKey))
      issue(
        issues,
        `contextPolicy.repositoryDocuments[${index}].repositoryKey`,
        'DOCUMENT_REPOSITORY_UNKNOWN',
        '文档引用关联的仓库 key 不在本定义中',
      );
  });

  return issues;
}

/** 服务端规范化 payload 的 sha256；客户端 payloadDigest 只用于声明，不能作为权威值。 */
export function workspaceDefinitionDigest(payload: WorkspaceDefinitionPayload): string {
  return createHash('sha256')
    .update(Buffer.from(canonicalJson(payload), 'utf8'))
    .digest('hex');
}

export type WorkspaceDocumentReference = { documentId: string; path: string };

/** 只收集 payload JSON 内的文档引用；不建立任何文档关系表或 FK。 */
export function collectDocumentReferences(
  payload: WorkspaceDefinitionPayload,
): WorkspaceDocumentReference[] {
  const refs: WorkspaceDocumentReference[] = [];
  payload.contextPolicy.requiredDocumentIds.forEach((documentId, index) =>
    refs.push({ documentId, path: `contextPolicy.requiredDocumentIds[${index}]` }),
  );
  for (const [roleKey, ids] of Object.entries(payload.contextPolicy.roleDocumentIds))
    ids.forEach((documentId, index) =>
      refs.push({ documentId, path: `contextPolicy.roleDocumentIds.${roleKey}[${index}]` }),
    );
  payload.contextPolicy.repositoryDocuments.forEach((entry, index) =>
    entry.documentIds.forEach((documentId, documentIndex) =>
      refs.push({
        documentId,
        path: `contextPolicy.repositoryDocuments[${index}].documentIds[${documentIndex}]`,
      }),
    ),
  );
  return refs;
}
