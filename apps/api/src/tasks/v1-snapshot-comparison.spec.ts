import { describe, expect, it } from 'vitest';
import { compareSnapshotInputs } from './v1-snapshot-comparison';
import type { V1SnapshotManifest } from './v1-snapshot-policy';

const manifest: V1SnapshotManifest = {
  schemaVersion: '1.0',
  projectId: 'p1',
  requirementId: 'r1',
  taskId: 't1',
  requirementGeneration: 1,
  taskGeneration: 1,
  workflowDefinitionRevisionId: 'w1',
  workflowDigest: 'a'.repeat(64),
  knowledgeBindingsVersion: 1,
  stepKey: 'impl',
  baselinePolicy: 'NONE',
  productBaseline: null,
  resources: [
    {
      refId: 'knowledge:doc',
      kind: 'DOCUMENT_REVISION',
      targetId: 'revision',
      sha256: 'b'.repeat(64),
      byteLength: 10,
      mediaType: 'text/plain',
      authority: 'PUBLISHED',
    },
  ],
};

describe('snapshot input comparison', () => {
  it.each([{ byteLength: 11 }, { mediaType: 'text/markdown' }])(
    'reports resource metadata changes even if the target and digest match: %j',
    (changed) => {
      const current = { ...manifest, resources: [{ ...manifest.resources[0], ...changed }] };
      expect(compareSnapshotInputs(manifest, current).changes).toEqual([
        {
          refId: 'knowledge:doc',
          kind: 'DOCUMENT_REVISION',
          status: 'CHANGED',
          previousTargetId: 'revision',
          currentTargetId: 'revision',
        },
      ]);
    },
  );
  it('ignores a binding counter change when actual task resources remain unchanged', () => {
    expect(compareSnapshotInputs(manifest, { ...manifest, knowledgeBindingsVersion: 2 })).toEqual({
      changes: [],
      metadataChanges: [],
    });
  });
});
