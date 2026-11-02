import { describe, expect, it } from 'vitest';
import {
  compileWorkflowDefinition,
  validateWorkflowDefinition,
  type WorkflowPackageLock,
} from './workflow';

describe('workflow semantic validation', () => {
  const base = {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey: 'demo',
    title: 'Demo',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [],
    steps: [{ key: 'release', roleKey: 'ops', kind: 'RELEASE', deps: [] }],
  };
  it('accepts a release DAG and returns a deterministic digest', () => {
    const result = validateWorkflowDefinition(base);
    expect(result.valid).toBe(true);
    expect(result.digest).toContain('"workflowKey":"demo"');
  });
  it('rejects unknown dependency and cycles', () => {
    const result = validateWorkflowDefinition({
      ...base,
      steps: [
        { key: 'a', deps: ['missing'] },
        { key: 'b', deps: ['a'] },
        { key: 'release', kind: 'RELEASE', deps: ['b'] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('DEPENDENCY_UNKNOWN');
    const cycle = validateWorkflowDefinition({
      ...base,
      steps: [
        { key: 'a', deps: ['b'] },
        { key: 'b', deps: ['a'] },
        { key: 'release', kind: 'RELEASE', deps: ['a'] },
      ],
    });
    expect(cycle.issues.map((issue) => issue.code)).toContain('WORKFLOW_CYCLE');
  });
});

describe('workflow compilation', () => {
  const roleIdsByKey = { product: 'r-1', backend: 'r-2', qa: 'r-3', ops: 'r-4' };
  const locks: WorkflowPackageLock[] = [
    {
      roleKey: 'product',
      packageId: 'product-pack',
      version: '1.0.0',
      packageDigest: 'a'.repeat(64),
    },
    {
      roleKey: 'backend',
      packageId: 'backend-pack',
      version: '1.0.0',
      packageDigest: 'b'.repeat(64),
    },
    { roleKey: 'qa', packageId: 'qa-pack', version: '1.0.0', packageDigest: 'c'.repeat(64) },
    { roleKey: 'ops', packageId: 'ops-pack', version: '1.0.0', packageDigest: 'd'.repeat(64) },
  ];
  const valid = {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey: 'backend-change',
    title: '后端变更',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [
      { key: 'release-owner', roleKey: 'ops', kind: 'RELEASE_ACCEPTANCE' },
      { key: 'impl-owner', roleKey: 'backend', kind: 'TASK_ACCEPTANCE' },
    ],
    steps: [
      {
        key: 'implement',
        roleKey: 'backend',
        kind: 'DELIVERY',
        baselinePolicy: 'PUBLISHED_PRD',
        outputKinds: ['IMPL'],
        deps: [],
        gates: [
          {
            key: 'accept',
            kind: 'HUMAN_APPROVAL',
            mode: 'ALL',
            outputKinds: ['IMPL'],
            reviewerSlots: ['impl-owner'],
          },
        ],
      },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        baselinePolicy: 'PUBLISHED_PRD',
        outputKinds: ['RELEASE'],
        deps: ['implement'],
        gates: [
          {
            key: 'publish',
            kind: 'HUMAN_APPROVAL',
            mode: 'ALL',
            outputKinds: ['RELEASE'],
            reviewerSlots: ['release-owner'],
          },
        ],
      },
    ],
  };

  it('compiles a valid DAG with code evidence gates and a stable digest', async () => {
    const first = await compileWorkflowDefinition(valid, { roleIdsByKey, packageLocks: locks });
    const second = await compileWorkflowDefinition(valid, { roleIdsByKey, packageLocks: locks });
    expect(first.valid).toBe(true);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digest).toBe(second.digest);
    expect(first.compiledRules?.systemGates).toEqual([
      { stepKey: 'implement', kind: 'CODE_REVIEW_EVIDENCE', required: true },
    ]);
    expect(first.compiledRules?.resolvedRoles).toEqual([
      { stepKey: 'implement', roleKey: 'backend', roleId: 'r-2' },
      { stepKey: 'release', roleKey: 'ops', roleId: 'r-4' },
    ]);
  });

  it('changes the digest when a package lock changes', async () => {
    const changed = await compileWorkflowDefinition(valid, {
      roleIdsByKey,
      packageLocks: [{ ...locks[0], packageDigest: 'e'.repeat(64) }, ...locks.slice(1)],
    });
    const original = await compileWorkflowDefinition(valid, { roleIdsByKey, packageLocks: locks });
    expect(changed.digest).not.toBe(original.digest);
  });

  it('rejects a RELEASE step whose gate is an ordinary acceptance slot', async () => {
    const bad = {
      ...valid,
      roleSlots: [{ key: 'ordinary', roleKey: 'ops', kind: 'TASK_ACCEPTANCE' }],
      steps: [
        {
          key: 'release',
          roleKey: 'ops',
          kind: 'RELEASE',
          outputKinds: ['RELEASE'],
          deps: [],
          gates: [
            {
              key: 'wrong',
              kind: 'HUMAN_APPROVAL',
              mode: 'ALL',
              outputKinds: ['RELEASE'],
              reviewerSlots: ['ordinary'],
            },
          ],
        },
      ],
    };
    const result = await compileWorkflowDefinition(bad, { roleIdsByKey, packageLocks: locks });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['WORKFLOW_RELEASE_GATE_REQUIRED']),
    );
    expect(result.digest).toBeNull();
  });

  it('rejects unknown roles, non-ALL approval and missing package locks', async () => {
    const result = await compileWorkflowDefinition(
      { ...valid, steps: [{ ...valid.steps[0], roleKey: 'ghost' }, valid.steps[1]] },
      { roleIdsByKey, packageLocks: [] },
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['WORKFLOW_ROLE_UNKNOWN', 'WORKFLOW_PACKAGE_INCOMPATIBLE']),
    );

    const anyMode = await compileWorkflowDefinition(
      {
        ...valid,
        steps: [
          { ...valid.steps[0], gates: [{ ...valid.steps[0].gates[0], mode: 'ANY' }] },
          valid.steps[1],
        ],
      },
      { roleIdsByKey, packageLocks: locks },
    );
    expect(anyMode.issues.map((issue) => issue.code)).toContain(
      'WORKFLOW_APPROVAL_MODE_UNSUPPORTED',
    );
  });

  it('rejects client-supplied system gates and excluded roles still in use', async () => {
    const supplied = await compileWorkflowDefinition(
      { ...valid, systemGates: [{ stepKey: 'implement' }] },
      { roleIdsByKey, packageLocks: locks },
    );
    expect(supplied.issues.map((issue) => issue.code)).toContain('WORKFLOW_UNKNOWN_FIELD');

    const excluded = await compileWorkflowDefinition(
      { ...valid, roleExclusions: [{ roleKey: 'backend', reason: 'still used' }] },
      { roleIdsByKey, packageLocks: locks },
    );
    expect(excluded.issues.map((issue) => issue.code)).toContain('WORKFLOW_SCOPE_MISMATCH');
  });
});
