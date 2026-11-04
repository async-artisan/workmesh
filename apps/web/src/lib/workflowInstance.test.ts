import { describe, expect, it } from 'vitest';
import type { WorkflowSlotDefinition, WorkflowStepDefinition } from '../api/resources';
import {
  buildInstanceBindings,
  defaultAcceptanceOwners,
  isImplStep,
  stepDependencyGraph,
  stepDependencyMap,
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

describe('stepDependencyGraph（依赖完整性不能静默丢失）', () => {
  it('空依赖且定义完整：该步骤依赖可判定，图为完整', () => {
    const graph = stepDependencyGraph({
      steps: [
        { key: 'prd', roleKey: 'product', deps: [] },
        { key: 'impl', roleKey: 'backend', deps: ['prd'] },
      ],
    });
    expect(graph.isDependencyGraphComplete).toBe(true);
    expect(graph.hasSteps).toBe(true);
    expect(graph.steps.prd).toEqual({
      stepKey: 'prd',
      dependencyKeys: [],
      unknownDependencyKeys: [],
      isDependencyGraphComplete: true,
    });
    expect(graph.steps.impl.dependencyKeys).toEqual(['prd']);
  });

  it('未知依赖原样保留，不静默过滤成「没有依赖」', () => {
    const graph = stepDependencyGraph({
      steps: [{ key: 'impl', roleKey: 'backend', deps: ['missing-step'] }],
    });
    expect(graph.isDependencyGraphComplete).toBe(false);
    expect(graph.steps.impl.dependencyKeys).toEqual(['missing-step']);
    expect(graph.steps.impl.unknownDependencyKeys).toEqual(['missing-step']);
    expect(graph.steps.impl.isDependencyGraphComplete).toBe(false);
    // 兼容入口也保留未知 key，调用方不能据此推断「无依赖」。
    expect(
      stepDependencyMap({ steps: [{ key: 'impl', roleKey: 'backend', deps: ['missing'] }] }),
    ).toEqual({ impl: ['missing'] });
  });

  it('定义缺少目标步骤时，图里没有该步骤（调用方按缺失处理）', () => {
    const graph = stepDependencyGraph({
      steps: [{ key: 'prd', roleKey: 'product', deps: [] }],
    });
    expect(graph.steps.impl).toBeUndefined();
    expect(graph.isDependencyGraphComplete).toBe(true);
  });

  it('空定义 hasSteps=false，任何任务都不能据此判定可领取', () => {
    const graph = stepDependencyGraph({});
    expect(graph.hasSteps).toBe(false);
    expect(graph.steps).toEqual({});
  });
});
