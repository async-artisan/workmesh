import { describe, expect, it } from 'vitest';
import { compareRoleResources } from './v1-role-package-comparison';
import type { V1SnapshotManifestResource } from './v1-snapshot-policy';
const ref = (refId: string, sha256 = 'a'.repeat(64)): V1SnapshotManifestResource => ({
  refId,
  kind: 'ROLE_RESOURCE',
  targetId: 'resource-1',
  sha256,
  byteLength: 10,
  mediaType: 'text/markdown',
  authority: 'PUBLISHED',
});
describe('role snapshot resource comparison', () => {
  it('ignores new target identities for identical role ref/hash/bytes and ignores unrelated document changes', () => {
    expect(
      compareRoleResources(
        [ref('role:sop')],
        [
          { ...ref('role:sop'), targetId: 'resource-new' },
          { ...ref('prd'), kind: 'DOCUMENT_REVISION' },
        ],
        new Map(),
      ),
    ).toEqual({ status: 'CURRENT', changes: [] });
  });
  it('reports only exact changed, added and removed role resources with readable paths', () => {
    expect(
      compareRoleResources(
        [ref('role:sop'), ref('role:old')],
        [ref('role:sop', 'b'.repeat(64)), ref('role:new')],
        new Map([
          ['role:sop', 'sop.md'],
          ['role:old', 'old.md'],
          ['role:new', 'new.md'],
        ]),
      ),
    ).toEqual({
      status: 'CHANGED',
      changes: [
        {
          refId: 'role:new',
          path: 'new.md',
          status: 'ADDED',
          previousSha256: null,
          currentSha256: 'a'.repeat(64),
        },
        {
          refId: 'role:old',
          path: 'old.md',
          status: 'REMOVED',
          previousSha256: 'a'.repeat(64),
          currentSha256: null,
        },
        {
          refId: 'role:sop',
          path: 'sop.md',
          status: 'CHANGED',
          previousSha256: 'a'.repeat(64),
          currentSha256: 'b'.repeat(64),
        },
      ],
    });
  });
});
