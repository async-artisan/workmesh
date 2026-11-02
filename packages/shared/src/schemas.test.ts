import { describe, expect, it } from 'vitest';
import { compareSemver, isStrictSemver, validateRolePackage } from './schemas';

describe('role package schema', () => {
  const valid = {
    packageSchemaVersion: '1.0', id: 'workmesh.product', version: '1.0.0', protocolVersion: '1.0', title: 'Product', roleKey: 'product',
    compatibility: { minCliVersion: '1.0.0', maxCliVersionExclusive: '2.0.0', contractVersion: '1.0' },
    inputs: [], outputs: [{ key: 'prd', channel: 'CANDIDATE', kind: 'PRD', contractVersion: '1.0' }],
    resources: [{ id: 'sop', kind: 'AGENT_ENTRY', path: 'sop.md', sha256: 'a'.repeat(64), byteLength: 1, mediaType: 'text/markdown' }],
    agentEntries: [{ host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' }],
  };

  it('accepts a strict manifest', () => expect(validateRolePackage(valid).valid).toBe(true));
  it('rejects unknown fields and malformed digest', () => {
    expect(validateRolePackage({ ...valid, extra: true }).valid).toBe(false);
    expect(validateRolePackage({ ...valid, resources: [{ ...valid.resources[0], sha256: 'short' }] }).valid).toBe(false);
  });

  it('accepts only strict SemVer values', () => {
    for (const value of ['1.0.0', '0.0.0', '1.2.3-rc.1', '1.2.3+build.7']) expect(isStrictSemver(value)).toBe(true);
    for (const value of ['v1.0.0', '1.0', '01.0.0', '1.0.0-01', 'demo']) expect(isStrictSemver(value)).toBe(false);
  });

  it('orders versions by SemVer precedence', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });
});
