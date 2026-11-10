import type { V1SnapshotManifest, V1SnapshotManifestResource } from './v1-snapshot-policy';

export type SnapshotInputChange = {
  refId: string;
  kind: V1SnapshotManifestResource['kind'];
  status: 'ADDED' | 'REMOVED' | 'CHANGED';
  previousTargetId: string | null;
  currentTargetId: string | null;
};

export function compareSnapshotInputs(previous: V1SnapshotManifest, current: V1SnapshotManifest) {
  const oldRefs = new Map(previous.resources.map((ref) => [ref.refId, ref]));
  const currentRefs = new Map(current.resources.map((ref) => [ref.refId, ref]));
  const changes: SnapshotInputChange[] = [];
  for (const refId of [...new Set([...oldRefs.keys(), ...currentRefs.keys()])].sort()) {
    const before = oldRefs.get(refId);
    const after = currentRefs.get(refId);
    if (
      before &&
      after &&
      before.kind === after.kind &&
      before.targetId === after.targetId &&
      before.sha256 === after.sha256 &&
      before.authority === after.authority &&
      before.byteLength === after.byteLength &&
      before.mediaType === after.mediaType
    )
      continue;
    changes.push({
      refId,
      kind: (after ?? before)!.kind,
      status: !before ? 'ADDED' : !after ? 'REMOVED' : 'CHANGED',
      previousTargetId: before?.targetId ?? null,
      currentTargetId: after?.targetId ?? null,
    });
  }
  const metadataChanges = (
    [
      'requirementGeneration',
      'taskGeneration',
      'workflowDefinitionRevisionId',
      'workflowDigest',
    ] as const
  ).filter((key) => previous[key] !== current[key]) as string[];
  if (
    previous.productBaseline?.deliveryScopeDigest !== current.productBaseline?.deliveryScopeDigest
  )
    metadataChanges.push('deliveryScope');
  // A global bindings version can move because another role changed. Only concrete refs
  // above determine whether this task's knowledge inputs changed.
  return { changes, metadataChanges };
}
