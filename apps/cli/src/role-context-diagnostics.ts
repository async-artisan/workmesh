import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  compareSemver,
  isStrictSemver,
  sha256Bytes,
  type TaskInputStatusView,
  type TaskRolePackageStatus,
} from '@workmesh/shared';
import { lockPath } from './config';

export type RoleContextDiagnostics = {
  scope: 'TASK' | 'SNAPSHOT';
  metadata: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_COMPARED';
  workflowDefinitionRevisionId: string | null;
  locked: TaskRolePackageStatus['locked'];
  latestAvailable: TaskRolePackageStatus['latestAvailable'];
  notices: Array<'UPDATE_AVAILABLE' | 'LOCAL_ROLE_PACKAGE_MISMATCH' | 'ROLE_PACKAGE_UPDATED'>;
  local: {
    status: 'MATCH' | 'MISSING' | 'MISMATCH' | 'UNREADABLE' | 'UNAVAILABLE' | 'NOT_COMPARED';
    issues: Array<{ path: string | null; reason: string }>;
  };
  resourceChanges: NonNullable<TaskRolePackageStatus['comparison']>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function safeSegments(path: string): string[] | null {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes(':') ||
    [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null;
  const parts = path.split('/');
  return parts.some((part) => !part || part === '.' || part === '..') ? null : parts;
}
async function safeFile(workspaceDir: string, segments: string[]): Promise<Buffer> {
  let current = workspaceDir;
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error('UNSAFE_LOCAL_PATH');
  }
  return readFile(current);
}

function validMetadata(value: TaskRolePackageStatus | undefined): value is TaskRolePackageStatus {
  if (
    !value ||
    !record(value) ||
    !['LOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE'].includes(value.status)
  )
    return false;
  if (typeof value.workflowDefinitionRevisionId !== 'string' || typeof value.roleKey !== 'string')
    return false;
  if (value.status !== 'LOCKED') return true;
  const locked = value.locked;
  return Boolean(
    locked &&
    record(locked) &&
    typeof locked.packageId === 'string' &&
    safeSegments(locked.packageId)?.length === 1 &&
    isStrictSemver(locked.version) &&
    digest(locked.packageDigest) &&
    Array.isArray(locked.resources) &&
    locked.resources.every(
      (resource) =>
        record(resource) &&
        typeof resource.refId === 'string' &&
        typeof resource.path === 'string' &&
        digest(resource.sha256) &&
        Number.isSafeInteger(resource.byteLength) &&
        resource.byteLength >= 0,
    ),
  );
}

export async function diagnoseRoleContext(input: {
  workspaceDir: string;
  status?: TaskInputStatusView;
  snapshotRevisionId?: string;
}): Promise<RoleContextDiagnostics> {
  const result: RoleContextDiagnostics = {
    scope: input.snapshotRevisionId ? 'SNAPSHOT' : 'TASK',
    metadata: input.snapshotRevisionId ? 'NOT_COMPARED' : 'UNAVAILABLE',
    workflowDefinitionRevisionId: input.snapshotRevisionId ?? null,
    locked: null,
    latestAvailable: null,
    notices: [],
    local: { status: input.snapshotRevisionId ? 'NOT_COMPARED' : 'UNAVAILABLE', issues: [] },
    resourceChanges: { status: 'UNAVAILABLE', changes: [] },
  };
  // An old snapshot never borrows the task's current package lock.
  if (input.snapshotRevisionId) return result;
  const metadata = input.status?.rolePackage;
  if (!validMetadata(metadata)) return result;
  result.workflowDefinitionRevisionId = metadata.workflowDefinitionRevisionId;
  if (metadata.status === 'UNAVAILABLE') return result;
  result.metadata = metadata.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'AVAILABLE';
  result.locked = metadata.locked;
  result.latestAvailable = metadata.latestAvailable;
  result.resourceChanges = metadata.comparison ?? result.resourceChanges;
  if (metadata.comparison?.status === 'CHANGED' && metadata.comparison.changes.length)
    result.notices.push('ROLE_PACKAGE_UPDATED');
  const locked = metadata.locked;
  if (metadata.status !== 'LOCKED' || !locked) return result;
  const latest = metadata.latestAvailable;
  if (
    latest &&
    latest.packageId === locked.packageId &&
    isStrictSemver(latest.version) &&
    compareSemver(latest.version, locked.version) > 0
  )
    result.notices.push('UPDATE_AVAILABLE');
  const lockRelative = relative(input.workspaceDir, lockPath(input.workspaceDir))
    .split('\\')
    .join('/');
  let localLock: unknown;
  try {
    localLock = JSON.parse(
      (await safeFile(input.workspaceDir, lockRelative.split('/'))).toString('utf8'),
    );
  } catch (error) {
    result.local = {
      status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'MISSING' : 'UNREADABLE',
      issues: [{ path: lockRelative, reason: 'LOCAL_LOCK_UNAVAILABLE' }],
    };
    result.notices.push('LOCAL_ROLE_PACKAGE_MISMATCH');
    return result;
  }
  if (
    !record(localLock) ||
    localLock.schemaVersion !== '1.0' ||
    !Array.isArray(localLock.packageLocks)
  ) {
    result.local = {
      status: 'UNREADABLE',
      issues: [{ path: lockRelative, reason: 'LOCAL_LOCK_INVALID' }],
    };
    result.notices.push('LOCAL_ROLE_PACKAGE_MISMATCH');
    return result;
  }
  const matches = localLock.packageLocks.filter(
    (entry) =>
      record(entry) &&
      entry.packageId === locked.packageId &&
      entry.version === locked.version &&
      entry.roleKey === metadata.roleKey &&
      entry.packageDigest === locked.packageDigest,
  );
  if (matches.length !== 1) {
    result.local = {
      status: 'MISMATCH',
      issues: [{ path: lockRelative, reason: 'EXACT_TASK_LOCK_NOT_INSTALLED' }],
    };
    result.notices.push('LOCAL_ROLE_PACKAGE_MISMATCH');
    return result;
  }
  result.local.status = 'MATCH';
  const seen = new Set<string>();
  for (const resource of locked.resources) {
    const segments = safeSegments(resource.path);
    if (!segments || seen.has(resource.path)) {
      result.local.issues.push({
        path: resource.path,
        reason: 'UNSAFE_OR_DUPLICATE_RESOURCE_PATH',
      });
      continue;
    }
    seen.add(resource.path);
    const path = ['.workmesh', 'packages', locked.packageId, locked.version, ...segments];
    try {
      const bytes = await safeFile(input.workspaceDir, path);
      if (
        bytes.byteLength !== resource.byteLength ||
        (await sha256Bytes(new Uint8Array(bytes))) !== resource.sha256
      )
        result.local.issues.push({ path: resource.path, reason: 'RESOURCE_BYTES_MISMATCH' });
    } catch (error) {
      result.local.issues.push({
        path: resource.path,
        reason:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'RESOURCE_MISSING'
            : 'RESOURCE_UNREADABLE',
      });
    }
  }
  if (result.local.issues.length) {
    result.local.status = 'MISMATCH';
    result.notices.push('LOCAL_ROLE_PACKAGE_MISMATCH');
  }
  return result;
}

export function renderRoleContext(diagnostic: RoleContextDiagnostics): string {
  if (diagnostic.scope === 'SNAPSHOT')
    return '角色包：历史快照仅使用自身资源；未与当前任务锁或本地安装比较。';
  if (diagnostic.metadata === 'UNAVAILABLE')
    return '角色包：平台未提供可用锁定元数据；不能确认本地安装匹配。';
  if (diagnostic.metadata === 'NOT_CONFIGURED')
    return '角色包：当前任务工作流未为此角色配置角色包锁；未核验本地安装。';
  const lines = [
    `角色包：${diagnostic.locked ? `${diagnostic.locked.packageId}@${diagnostic.locked.version}` : '没有可核验的任务角色包锁'}；本地 ${diagnostic.local.status}`,
  ];
  if (diagnostic.notices.includes('UPDATE_AVAILABLE'))
    lines.push(
      `UPDATE_AVAILABLE：${diagnostic.latestAvailable!.version} 可用；在途任务仍锁定 ${diagnostic.locked!.version}。`,
    );
  if (diagnostic.notices.includes('LOCAL_ROLE_PACKAGE_MISMATCH'))
    lines.push(
      'LOCAL_ROLE_PACKAGE_MISMATCH：安装任务锁定的准确版本并核对资源；未自动更新或覆盖本地文件。',
    );
  if (diagnostic.notices.includes('ROLE_PACKAGE_UPDATED')) {
    lines.push('ROLE_PACKAGE_UPDATED：与任务上次快照相比角色资源已变化，请重新阅读以下资源：');
    for (const change of diagnostic.resourceChanges.changes)
      lines.push(`  ${change.status} ${change.path ?? change.refId}`);
  }
  for (const issue of diagnostic.local.issues)
    lines.push(`  ${issue.reason}${issue.path ? ` ${issue.path}` : ''}`);
  if (diagnostic.resourceChanges.status === 'UNAVAILABLE')
    lines.push('无法与任务上次角色资源比较，不能认定上下文未变化。');
  return lines.join('\n');
}
