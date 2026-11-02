import { describe, expect, it } from 'vitest';
import { compileWorkflowDefinition, type WorkflowPackageLock } from './workflow';
import {
  buildStandardWorkflowTemplate,
  STANDARD_TEMPLATE_ROLE_KEYS,
  STANDARD_WORKFLOW_KEY,
  usedWorkflowRoleKeys,
} from './workflow-template';

const roleIdsByKey: Record<string, string> = {
  product: 'r-product',
  ui: 'r-ui',
  frontend: 'r-frontend',
  backend: 'r-backend',
  qa: 'r-qa',
  ops: 'r-ops',
};

function locksFor(roleKeys: readonly string[]): WorkflowPackageLock[] {
  return roleKeys.map((roleKey) => ({
    roleKey,
    packageId: `${roleKey}-pack`,
    version: '1.0.0',
    packageDigest: roleKey.length.toString(16).padStart(2, '0').repeat(32),
  }));
}

describe('standard workflow template', () => {
  it('compiles end to end with the default project roles and their package locks', async () => {
    const template = buildStandardWorkflowTemplate();
    const result = await compileWorkflowDefinition(template, {
      roleIdsByKey,
      packageLocks: locksFor(STANDARD_TEMPLATE_ROLE_KEYS),
    });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    // IMPL 步骤必须由服务端派生代码评审闸门，模板不能自己声明 systemGates。
    expect(result.compiledRules?.systemGates).toEqual([
      { stepKey: 'impl', kind: 'CODE_REVIEW_EVIDENCE', required: true },
    ]);
    expect(usedWorkflowRoleKeys(template)).toEqual([...STANDARD_TEMPLATE_ROLE_KEYS].sort());
  });

  it('uses the conventional workflow key and stays stable across rebuilds', () => {
    const first = buildStandardWorkflowTemplate();
    const second = buildStandardWorkflowTemplate();
    expect(first.workflowKey).toBe(STANDARD_WORKFLOW_KEY);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // 每次返回新对象：页面编辑模板不能污染后续调用。
    expect(first).not.toBe(second);
  });

  it('fails compilation when a used role has no package lock', async () => {
    const result = await compileWorkflowDefinition(buildStandardWorkflowTemplate(), {
      roleIdsByKey,
      packageLocks: locksFor(['product', 'frontend', 'ops']),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('WORKFLOW_PACKAGE_INCOMPATIBLE');
  });

  it('fails compilation when a used role does not exist in the project', async () => {
    const result = await compileWorkflowDefinition(buildStandardWorkflowTemplate(), {
      roleIdsByKey: { product: 'r-product', frontend: 'r-frontend', qa: 'r-qa' },
      packageLocks: locksFor(STANDARD_TEMPLATE_ROLE_KEYS),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('WORKFLOW_ROLE_UNKNOWN');
  });

  it('lets callers override the workflow key and title for a second definition', () => {
    const template = buildStandardWorkflowTemplate({
      workflowKey: 'fast-track',
      title: '快速通道',
    });
    expect(template.workflowKey).toBe('fast-track');
    expect(template.title).toBe('快速通道');
  });
});

describe('usedWorkflowRoleKeys', () => {
  it('collects step and role-slot roles once, sorted', () => {
    expect(
      usedWorkflowRoleKeys({
        steps: [{ roleKey: 'ops' }, { roleKey: 'product' }, { roleKey: 'ops' }],
        roleSlots: [{ roleKey: 'product' }],
      }),
    ).toEqual(['ops', 'product']);
  });

  it('returns an empty list for malformed input instead of throwing', () => {
    expect(usedWorkflowRoleKeys(null)).toEqual([]);
    expect(usedWorkflowRoleKeys('nope')).toEqual([]);
    expect(usedWorkflowRoleKeys({ steps: 'nope' })).toEqual([]);
  });
});
