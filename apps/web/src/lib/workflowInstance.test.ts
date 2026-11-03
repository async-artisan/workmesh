import { describe, expect, it } from 'vitest';
import type { WorkflowSlotDefinition, WorkflowStepDefinition } from '../api/resources';
import {
  buildInstanceBindings,
  defaultAcceptanceOwners,
  isImplStep,
} from '../lib/workflowInstance';

const steps: WorkflowStepDefinition[] = [
  { key: 'prd', roleKey: 'product', kind: 'PRODUCT', outputKinds: ['PRD'] },
  { key: 'impl-be', roleKey: 'backend', kind: 'DELIVERY', outputKinds: ['IMPL'] },
  { key: 'verify', roleKey: 'qa', kind: 'VERIFY', outputKinds: ['CASES'] },
];

const slots: WorkflowSlotDefinition[] = [
  { key: 'task-acceptance', roleKey: 'qa' },
  { key: 'release-acceptance', roleKey: 'product' },
];

const roles = [
  { key: 'product', id: 'role-product' },
  { key: 'backend', id: 'role-backend' },
  { key: 'qa', id: 'role-qa' },
];

function baseInput() {
  return {
    steps,
    slots,
    roles,
    stepUsers: { prd: 'u-pm', 'impl-be': 'u-be', verify: 'u-qa' },
    slotUsers: { 'task-acceptance': 'u-qa2', 'release-acceptance': 'u-pm2' },
    repositories: { 'impl-be': ['repo-1'] },
    acceptanceKeys: ['A1', 'A2'],
    acceptanceOwners: { A1: 'verify', A2: 'verify' },
  };
}

describe('workflowInstance', () => {
  it('只把带 IMPL 产出的步骤当作必须声明仓库的步骤', () => {
    expect(isImplStep(steps[1])).toBe(true);
    expect(isImplStep(steps[0])).toBe(false);
    expect(isImplStep({ key: 'x', roleKey: 'ops' })).toBe(false);
  });

  it('验收默认归到验证步骤，没有验证步骤时归到最后一步', () => {
    expect(defaultAcceptanceOwners(['A1', 'A2'], steps)).toEqual({ A1: 'verify', A2: 'verify' });
    expect(defaultAcceptanceOwners(['A1'], [steps[0], steps[1]])).toEqual({ A1: 'impl-be' });
    expect(defaultAcceptanceOwners([], steps)).toEqual({});
  });

  it('拼出服务端要求的绑定：IMPL 带仓库，验收按归属落到任务', () => {
    const { stepBindings, roleSlotBindings } = buildInstanceBindings(baseInput());

    expect(stepBindings).toEqual([
      {
        stepKey: 'prd',
        roleId: 'role-product',
        responsibleUserId: 'u-pm',
        repositoryIds: [],
        acceptanceKeys: [],
      },
      {
        stepKey: 'impl-be',
        roleId: 'role-backend',
        responsibleUserId: 'u-be',
        repositoryIds: ['repo-1'],
        acceptanceKeys: [],
      },
      {
        stepKey: 'verify',
        roleId: 'role-qa',
        responsibleUserId: 'u-qa',
        repositoryIds: [],
        acceptanceKeys: ['A1', 'A2'],
      },
    ]);
    expect(roleSlotBindings).toEqual([
      { slotKey: 'task-acceptance', roleId: 'role-qa', userId: 'u-qa2' },
      { slotKey: 'release-acceptance', roleId: 'role-product', userId: 'u-pm2' },
    ]);
  });

  it('IMPL 步骤没选仓库时直接拒绝，不把半成品发给服务端', () => {
    expect(() => buildInstanceBindings({ ...baseInput(), repositories: {} })).toThrow(
      '步骤 impl-be 要交付代码，至少选择一个代码仓库',
    );
  });

  it('验收条目没有归属时拒绝', () => {
    expect(() =>
      buildInstanceBindings({ ...baseInput(), acceptanceOwners: { A1: 'verify' } }),
    ).toThrow('验收条目 A2 还没有归属步骤');
  });

  it('没选责任人或审批人时拒绝', () => {
    expect(() => buildInstanceBindings({ ...baseInput(), stepUsers: { prd: 'u-pm' } })).toThrow(
      '步骤 impl-be 未选择责任人',
    );
    expect(() => buildInstanceBindings({ ...baseInput(), slotUsers: {} })).toThrow(
      '审批槽 task-acceptance 未选择审批人',
    );
  });
});
