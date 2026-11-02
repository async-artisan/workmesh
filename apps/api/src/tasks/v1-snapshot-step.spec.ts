import { describe, expect, it } from 'vitest';
import { buildStandardWorkflowTemplate } from '@workmesh/shared';
import {
  snapshotBaselinePolicyOf,
  snapshotDependenciesOf,
  snapshotStepsOf,
} from './v1-snapshot-step';

describe('snapshot step parsing', () => {
  const definition = buildStandardWorkflowTemplate();

  it('reads steps from the definition itself', () => {
    expect(snapshotStepsOf(definition).map((step) => step.key)).toEqual([
      'understanding',
      'prd',
      'impl',
      'cases',
      'release',
    ]);
  });

  it('returns the declared baseline policy per step', () => {
    expect(snapshotBaselinePolicyOf(definition, 'impl')).toBe('PUBLISHED_PRD');
    expect(snapshotBaselinePolicyOf(definition, 'cases')).toBe('PUBLISHED_PRD');
    // PRODUCT/NONE 步骤不得声明 PRD 基线。
    expect(snapshotBaselinePolicyOf(definition, 'prd')).toBe('NONE');
    expect(snapshotBaselinePolicyOf(definition, 'understanding')).toBe('NONE');
  });

  it('returns direct dependencies per step', () => {
    expect(snapshotDependenciesOf(definition, 'cases')).toEqual(['impl']);
    expect(snapshotDependenciesOf(definition, 'impl')).toEqual(['prd']);
    expect(snapshotDependenciesOf(definition, 'understanding')).toEqual([]);
  });

  it('never reads step semantics out of compiledRules', () => {
    // 回归：compiledRules 只有服务端派生规则，不含 steps；拿它当定义必须得到空结果，
    // 这样任何"又传错对象"的改动都会立刻被这条用例打回。
    const compiledRules = { resolvedRoles: [], packageLocks: [], systemGates: [] };
    expect(snapshotStepsOf(compiledRules)).toEqual([]);
    expect(snapshotBaselinePolicyOf(compiledRules, 'impl')).toBe('NONE');
    expect(snapshotDependenciesOf(compiledRules, 'cases')).toEqual([]);
  });

  it('degrades to empty results for malformed input instead of throwing', () => {
    expect(snapshotStepsOf(null)).toEqual([]);
    expect(snapshotStepsOf('nope')).toEqual([]);
    expect(snapshotStepsOf({ steps: 'nope' })).toEqual([]);
    expect(snapshotStepsOf({ steps: [null, { key: '' }, { deps: ['x'] }] })).toEqual([]);
    expect(snapshotBaselinePolicyOf({}, 'impl')).toBe('NONE');
    expect(snapshotDependenciesOf({ steps: [{ key: 'a', deps: [1, 'b'] }] }, 'a')).toEqual(['b']);
  });
});
