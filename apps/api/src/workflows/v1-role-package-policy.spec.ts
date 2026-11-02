import { describe, expect, it } from 'vitest';
import { sha256Bytes } from '@workmesh/shared';
import { validateRolePackageInput } from './v1-role-package-policy';

const encoder = new TextEncoder();

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packageSchemaVersion: '1.0',
    id: 'workmesh.product',
    version: '1.2.3',
    protocolVersion: '1.0',
    title: 'Product',
    roleKey: 'product',
    compatibility: { minCliVersion: '1.0.0', maxCliVersionExclusive: '2.0.0', contractVersion: '1.0' },
    inputs: [],
    outputs: [{ key: 'prd', channel: 'CANDIDATE', kind: 'PRD', contractVersion: '1.0' }],
    resources: [
      { id: 'sop', kind: 'AGENT_ENTRY', path: 'docs/sop.md', sha256: '0'.repeat(64), byteLength: 0, mediaType: 'text/markdown' },
    ],
    agentEntries: [{ host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' }],
    ...overrides,
  };
}

async function withResource(value: Record<string, unknown>, body: string): Promise<Record<string, unknown>> {
  const bytes = encoder.encode(body);
  const sha256 = await sha256Bytes(bytes);
  const resources = (value.resources as Array<Record<string, unknown>>).map((resource) =>
    resource.id === 'sop' ? { ...resource, sha256, byteLength: bytes.byteLength } : resource,
  );
  return { ...value, resources };
}

describe('validateRolePackageInput', () => {
  it('accepts an exact manifest and resource bytes', async () => {
    const value = await withResource(manifest(), '# SOP\n');
    const result = await validateRolePackageInput(value, [
      { resourceId: 'sop', bodyBytes: encoder.encode('# SOP\n') },
    ]);
    expect(result.valid).toBe(true);
    expect(result.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.resources[0]).toMatchObject({ resourceId: 'sop', path: 'docs/sop.md', byteLength: 6 });
  });

  it('rejects non SemVer versions and reversed compatibility ranges', async () => {
    const value = await withResource(
      manifest({
        version: 'v1.2.3',
        compatibility: { minCliVersion: '2.0.0', maxCliVersionExclusive: '1.0.0', contractVersion: '1.0' },
      }),
      '',
    );
    const result = await validateRolePackageInput(value, [{ resourceId: 'sop', bodyBytes: encoder.encode('') }]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['SEMVER_INVALID', 'COMPATIBILITY_RANGE_INVALID']),
    );
  });

  it('rejects unsafe resource paths', async () => {
    const value = await withResource(
      manifest({
        resources: [
          { id: 'sop', kind: 'AGENT_ENTRY', path: '../escape.md', sha256: '0'.repeat(64), byteLength: 0, mediaType: 'text/markdown' },
        ],
      }),
      '',
    );
    const result = await validateRolePackageInput(value, [{ resourceId: 'sop', bodyBytes: encoder.encode('') }]);
    expect(result.issues.map((issue) => issue.code)).toContain('RESOURCE_PATH_UNSAFE');
  });

  it('rejects missing, extra or mismatched resources', async () => {
    const value = await withResource(manifest(), 'real');
    const result = await validateRolePackageInput(value, [
      { resourceId: 'sop', bodyBytes: encoder.encode('tampered') },
      { resourceId: 'extra', bodyBytes: encoder.encode('x') },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['RESOURCE_DIGEST_MISMATCH', 'RESOURCE_UNKNOWN']),
    );
  });

  it('rejects an unknown template resource and duplicate agent host', async () => {
    const value = await withResource(
      manifest({
        outputs: [{ key: 'prd', channel: 'CANDIDATE', kind: 'PRD', contractVersion: '1.0', templateResourceId: 'ghost' }],
        agentEntries: [
          { host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' },
          { host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' },
        ],
      }),
      '',
    );
    const result = await validateRolePackageInput(value, [{ resourceId: 'sop', bodyBytes: encoder.encode('') }]);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['RESOURCE_UNKNOWN', 'AGENT_ENTRY_DUPLICATE']),
    );
  });
});
