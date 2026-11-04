import { describe, expect, it } from 'vitest';
import { resolveTaskDisplayState } from './taskDisplayState';

function doneKeys(...keys: string[]): ReadonlySet<string> {
  return new Set(keys);
}

describe('resolveTaskDisplayState（任务展示状态的唯一映射）', () => {
  it('未完成（OPEN）但没有依赖信息时只能是「状态待确认」，不能是可领取', () => {
    const state = resolveTaskDisplayState({
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      dependsOnStepKeys: null,
      doneStepKeys: null,
    });
    expect(state.kind).toBe('UNKNOWN');
    expect(state.claimable).toBe(false);
    expect(state.label).toContain('待确认');
  });

  it('依赖信息可用且前置都完成时才允许「可立即领取」', () => {
    const claimable = resolveTaskDisplayState({
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      dependsOnStepKeys: ['prd'],
      doneStepKeys: doneKeys('prd'),
    });
    expect(claimable.kind).toBe('CLAIMABLE');
    expect(claimable.claimable).toBe(true);

    const waiting = resolveTaskDisplayState({
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      dependsOnStepKeys: ['prd', 'design'],
      doneStepKeys: doneKeys('prd'),
    });
    expect(waiting.kind).toBe('WAITING_PREDECESSOR');
    expect(waiting.claimable).toBe(false);
    expect(waiting.missingPredecessors).toEqual(['design']);
  });

  it('没有前置依赖且依赖信息可用时算可领取', () => {
    const state = resolveTaskDisplayState({
      executionStatus: 'OPEN',
      dependsOnStepKeys: [],
      doneStepKeys: doneKeys(),
    });
    expect(state.kind).toBe('CLAIMABLE');
  });

  it('完成、取消、阻塞/冻结、待审批、执行中分别映射为不同状态', () => {
    expect(resolveTaskDisplayState({ executionStatus: 'DONE' }).kind).toBe('DONE');
    expect(
      resolveTaskDisplayState({ executionStatus: 'OPEN', workStatus: 'CANCELLED' }).kind,
    ).toBe('CANCELLED');
    expect(
      resolveTaskDisplayState({ executionStatus: 'OPEN', workStatus: 'BLOCKED' }).kind,
    ).toBe('BLOCKED_OR_FROZEN');
    expect(
      resolveTaskDisplayState({ executionStatus: 'OPEN', workStatus: 'PAUSED' }).kind,
    ).toBe('BLOCKED_OR_FROZEN');
    expect(
      resolveTaskDisplayState({ executionStatus: 'REVIEW_PENDING', workStatus: 'ACTIVE' }).kind,
    ).toBe('WAITING_APPROVAL');
    expect(
      resolveTaskDisplayState({ executionStatus: 'OPEN', reviewStatus: 'OPEN' }).kind,
    ).toBe('WAITING_APPROVAL');
    expect(
      resolveTaskDisplayState({ executionStatus: 'OPEN', currentClaimId: 'claim-1' }).kind,
    ).toBe('IN_PROGRESS');
    expect(resolveTaskDisplayState({ executionStatus: 'ACTIVE' }).kind).toBe('IN_PROGRESS');
  });

  it('未知执行状态不能落到可领取', () => {
    const state = resolveTaskDisplayState({
      executionStatus: 'SOMETHING_NEW',
      dependsOnStepKeys: [],
      doneStepKeys: doneKeys(),
    });
    expect(state.kind).toBe('UNKNOWN');
    expect(state.claimable).toBe(false);
  });

  it('阻塞状态优先于依赖判断（被冻结时即使前置完成也不能领）', () => {
    const state = resolveTaskDisplayState({
      executionStatus: 'OPEN',
      workStatus: 'PAUSED',
      dependsOnStepKeys: [],
      doneStepKeys: doneKeys(),
    });
    expect(state.kind).toBe('BLOCKED_OR_FROZEN');
    expect(state.claimable).toBe(false);
  });
});
