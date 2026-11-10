import type { TaskRolePackageStatus } from '@workmesh/shared';
import type { V1SnapshotManifestResource } from './v1-snapshot-policy';

export function compareRoleResources(
  previous: V1SnapshotManifestResource[],
  current: V1SnapshotManifestResource[],
  paths: Map<string, string>,
): NonNullable<TaskRolePackageStatus['comparison']> {
  const before = new Map(
    previous.filter((ref) => ref.kind === 'ROLE_RESOURCE').map((ref) => [ref.refId, ref]),
  );
  const after = new Map(
    current.filter((ref) => ref.kind === 'ROLE_RESOURCE').map((ref) => [ref.refId, ref]),
  );
  const changes: NonNullable<TaskRolePackageStatus['comparison']>['changes'] = [];
  for (const refId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(refId),
      next = after.get(refId);
    if (old && next && old.sha256 === next.sha256 && old.byteLength === next.byteLength) continue;
    changes.push({
      refId,
      path: paths.get(refId) ?? null,
      status: !old ? 'ADDED' : !next ? 'REMOVED' : 'CHANGED',
      previousSha256: old?.sha256 ?? null,
      currentSha256: next?.sha256 ?? null,
    });
  }
  return { status: changes.length ? 'CHANGED' : 'CURRENT', changes };
}
