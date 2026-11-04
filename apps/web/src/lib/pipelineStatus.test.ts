import { describe, expect, it } from 'vitest';
import {
  computePipelineStats,
  describeExecutionStatus,
  describeRequirementState,
  normalizePhase,
  phaseLabelOf,
  pipelineStatKeyOf,
  requirementStageProgress,
  stageConnectorCompletion,
  stageCounts,
  stageProgressLabel,
} from './pipelineStatus';

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    ...overrides,
  };
}

describe('pipelineStatus（阶段与执行状态是两个维度）', () => {
  it('阶段来自 phase，执行状态来自 workStatus，互不替代', () => {
    const state = describeRequirementState({ phase: 'DELIVERY', workStatus: 'ACTIVE' });
    expect(state.phase.key).toBe('DELIVERY');
    expect(state.phase.label).toBe('交付');
    expect(state.execution.label).toBe('进行中');
    expect(state.execution.source).toBe('workStatus');
    expect(state.isReleased).toBe(false);
  });

  it('workStatus 的四种服务端枚举分别映射为进行中/阻塞/暂停/已取消', () => {
    expect(describeExecutionStatus({ workStatus: 'ACTIVE' }).kind).toBe('IN_PROGRESS');
    expect(describeExecutionStatus({ workStatus: 'BLOCKED' }).kind).toBe('BLOCKED');
    expect(describeExecutionStatus({ workStatus: 'PAUSED' }).kind).toBe('PAUSED');
    expect(describeExecutionStatus({ workStatus: 'CANCELLED' }).kind).toBe('CANCELLED');
  });

  it('缺少或未知 workStatus 时是状态待确认，不推断为进行中', () => {
    const missing = describeRequirementState({ phase: 'DELIVERY', workStatus: null });
    expect(missing.execution.kind).toBe('UNKNOWN');
    expect(missing.execution.label).toBe('状态待确认');
    expect(missing.execution.source).toBe('none');

    const unknown = describeRequirementState({ phase: 'DELIVERY', workStatus: 'SOMETHING_NEW' });
    expect(unknown.execution.kind).toBe('UNKNOWN');
  });

  it('只有服务端显式 executionStatus=OPEN 才显示未开始（当前列表契约不返回该字段）', () => {
    const notStarted = describeRequirementState({
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      executionStatus: 'OPEN',
    });
    expect(notStarted.execution.kind).toBe('NOT_STARTED');
    expect(notStarted.execution.source).toBe('executionStatus');
    expect(notStarted.execution.label).toBe('未开始');

    // 没有显式 field 时 ACTIVE 仍是进行中，而不是“未开始”。
    expect(describeExecutionStatus({ workStatus: 'ACTIVE' }).kind).toBe('IN_PROGRESS');
  });

  it('已发布是业务阶段，不是执行状态；执行状态仍来自 workStatus', () => {
    const released = describeRequirementState({ phase: 'RELEASED', workStatus: 'ACTIVE' });
    expect(released.isReleased).toBe(true);
    expect(released.phase.label).toBe('已发布');
    expect(released.execution.kind).toBe('IN_PROGRESS');
    expect(released.execution.label).not.toBe('已发布');
  });

  it('executionStatus 的存在性、null 与未知枚举要区分，未知值不能归入进行中', () => {
    // 当前契约：字段缺失 -> ACTIVE 仍可显示进行中。
    const missing = describeExecutionStatus({ workStatus: 'ACTIVE' });
    expect(missing.kind).toBe('IN_PROGRESS');
    expect(missing.source).toBe('workStatus');

    // API 适配层显式声明“字段未提供”：即使值是 null 也按进行中。
    const providedFalse = describeExecutionStatus({
      workStatus: 'ACTIVE',
      executionStatus: null,
      executionStatusProvided: false,
    });
    expect(providedFalse.kind).toBe('IN_PROGRESS');

    // 字段显式存在但为 null：无法确认，进入状态待确认。
    const providedNull = describeExecutionStatus({
      workStatus: 'ACTIVE',
      executionStatus: null,
      executionStatusProvided: true,
    });
    expect(providedNull.kind).toBe('UNKNOWN');
    expect(providedNull.source).toBe('executionStatus');

    // 旧调用方传 null 但未声明存在性：保守按已提供处理，不猜进行中。
    const legacyNull = describeExecutionStatus({ workStatus: 'ACTIVE', executionStatus: null });
    expect(legacyNull.kind).toBe('UNKNOWN');

    // 显式未知枚举：前端不猜测新增枚举。
    const unknownValue = describeExecutionStatus({
      workStatus: 'ACTIVE',
      executionStatus: 'SOMETHING_NEW',
    });
    expect(unknownValue.kind).toBe('UNKNOWN');
    expect(unknownValue.label).toBe('状态待确认');
    expect(unknownValue.description).toContain('SOMETHING_NEW');

    // 当前契约唯一已知执行状态是 OPEN；其它“看起来已知”的显式值也不能猜。
    expect(describeExecutionStatus({ workStatus: 'ACTIVE', executionStatus: 'OPEN' }).kind).toBe(
      'NOT_STARTED',
    );
    expect(
      describeExecutionStatus({ workStatus: 'ACTIVE', executionStatus: 'IN_PROGRESS' }).kind,
    ).toBe('UNKNOWN');
  });

  it('显式未知 executionStatus 的统计进入状态待确认，不落入进行中', () => {
    expect(
      pipelineStatKeyOf({
        phase: 'DELIVERY',
        workStatus: 'ACTIVE',
        executionStatus: 'SOMETHING_NEW',
      }),
    ).toBe('UNKNOWN');
    expect(
      pipelineStatKeyOf({
        phase: 'DELIVERY',
        workStatus: 'ACTIVE',
        executionStatus: null,
        executionStatusProvided: true,
      }),
    ).toBe('UNKNOWN');
    expect(
      pipelineStatKeyOf({
        phase: 'DELIVERY',
        workStatus: 'ACTIVE',
        executionStatus: null,
        executionStatusProvided: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('归档不等于已发布', () => {
    const archived = describeRequirementState({ phase: 'ARCHIVED', workStatus: 'ACTIVE' });
    expect(archived.isArchived).toBe(true);
    expect(archived.isReleased).toBe(false);
    expect(pipelineStatKeyOf(archived.requirement)).toBe('ARCHIVED');
  });

  it('未知阶段不崩溃，阶段标签为阶段待确认', () => {
    const unknown = describeRequirementState({ phase: 'SOMETHING_NEW', workStatus: 'ACTIVE' });
    expect(unknown.phase.known).toBe(false);
    expect(unknown.phase.label).toBe('阶段待确认');
    expect(pipelineStatKeyOf(unknown.requirement)).toBe('UNKNOWN');
    expect(normalizePhase('SOMETHING_NEW')).toBeNull();
    expect(phaseLabelOf('SOMETHING_NEW')).toBe('阶段待确认');
  });
});

describe('pipelineStatus（互斥统计口径）', () => {
  const mixed = [
    requirement({ phase: 'DELIVERY', workStatus: 'ACTIVE' }),
    requirement({ phase: 'DELIVERY', workStatus: 'BLOCKED' }),
    requirement({ phase: 'ACCEPTANCE', workStatus: 'PAUSED' }),
    requirement({ phase: 'DISCOVERY', workStatus: 'CANCELLED' }),
    requirement({ phase: 'RELEASED', workStatus: 'ACTIVE' }),
    requirement({ phase: 'ARCHIVED', workStatus: 'ACTIVE' }),
    requirement({ phase: 'DEFINITION', workStatus: null }),
    requirement({ phase: 'DELIVERY', workStatus: 'ACTIVE', executionStatus: 'OPEN' }),
  ];

  it('每个需求只落入一个分类，合计等于全部需求', () => {
    const stats = computePipelineStats(mixed);
    expect(stats.total).toBe(mixed.length);
    expect(stats.sum).toBe(stats.total);
    expect(stats.counts).toEqual({
      NOT_STARTED: 1,
      IN_PROGRESS: 1,
      BLOCKED: 1,
      PAUSED: 1,
      CANCELLED: 1,
      RELEASED: 1,
      ARCHIVED: 1,
      UNKNOWN: 1,
    });
  });

  it('阻塞、暂停、取消不会计入进行中，未知状态进入状态待确认', () => {
    const stats = computePipelineStats(mixed);
    expect(stats.counts.IN_PROGRESS).toBe(1);
    expect(stats.counts.BLOCKED).toBe(1);
    expect(stats.counts.PAUSED).toBe(1);
    expect(stats.counts.CANCELLED).toBe(1);
    expect(stats.counts.UNKNOWN).toBe(1);
  });

  it('已发布与已归档按业务阶段统计，且归档不计入已发布', () => {
    const stats = computePipelineStats([
      requirement({ phase: 'RELEASED', workStatus: 'ACTIVE' }),
      requirement({ phase: 'ARCHIVED', workStatus: 'ACTIVE' }),
    ]);
    expect(stats.counts.RELEASED).toBe(1);
    expect(stats.counts.ARCHIVED).toBe(1);
  });

  it('workStatus 未知的已发布阶段不会凭阶段推断为已发布', () => {
    expect(pipelineStatKeyOf({ phase: 'RELEASED', workStatus: null })).toBe('UNKNOWN');
    expect(pipelineStatKeyOf({ phase: 'RELEASED', workStatus: 'BLOCKED' })).toBe('BLOCKED');
  });
});

describe('pipelineStatus（阶段进度与连接线完成证据）', () => {
  it('当前阶段显示当前，前置阶段在无完成证据时显示“已越过”，后续待进入', () => {
    const item = requirement({ phase: 'DELIVERY', workStatus: 'ACTIVE' });
    expect(requirementStageProgress(item, 'DISCOVERY')).toBe('passed');
    expect(requirementStageProgress(item, 'DEFINITION')).toBe('passed');
    expect(requirementStageProgress(item, 'DELIVERY')).toBe('current');
    expect(requirementStageProgress(item, 'ACCEPTANCE')).toBe('pending');
    expect(stageProgressLabel('passed')).toBe('已越过');
    expect(stageProgressLabel('complete')).toBe('已完成（服务端完成证据）');
  });

  it('只有显式完成记录才把前置阶段标为已完成', () => {
    const item = requirement({
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      stageCompletion: { completedPhases: ['DISCOVERY'] },
    });
    expect(requirementStageProgress(item, 'DISCOVERY')).toBe('complete');
    expect(requirementStageProgress(item, 'DEFINITION')).toBe('passed');
  });

  it('RELEASED 不会自动让所有前置阶段变成已完成', () => {
    const released = requirement({ phase: 'RELEASED', workStatus: 'ACTIVE' });
    for (const stage of ['DISCOVERY', 'DEFINITION', 'DELIVERY', 'ACCEPTANCE'] as const)
      expect(requirementStageProgress(released, stage)).toBe('passed');
  });

  it('未知阶段的所有阶段进度都是阶段待确认', () => {
    const unknown = requirement({ phase: 'SOMETHING_NEW', workStatus: 'ACTIVE' });
    expect(requirementStageProgress(unknown, 'DISCOVERY')).toBe('unknown');
  });

  it('连接线只有全部需求都有该阶段完成记录时才完成', () => {
    const noEvidence = [requirement({ phase: 'DELIVERY' }), requirement({ phase: 'ACCEPTANCE' })];
    expect(stageConnectorCompletion(noEvidence, 'DISCOVERY').complete).toBe(false);
    expect(stageConnectorCompletion(noEvidence, 'DISCOVERY').reason).toBe('no-evidence');
    expect(stageConnectorCompletion([], 'DISCOVERY').complete).toBe(false);

    const partial = [
      requirement({
        phase: 'DELIVERY',
        stageCompletion: { completedPhases: ['DISCOVERY'] },
      }),
      requirement({ phase: 'ACCEPTANCE' }),
    ];
    const partialResult = stageConnectorCompletion(partial, 'DISCOVERY');
    expect(partialResult.complete).toBe(false);
    expect(partialResult.reason).toBe('partial');

    const complete = [
      requirement({
        phase: 'DELIVERY',
        stageCompletion: { completedPhases: ['DISCOVERY'] },
      }),
      requirement({
        phase: 'ACCEPTANCE',
        stageCompletion: { completedPhases: ['DISCOVERY'] },
      }),
    ];
    expect(stageConnectorCompletion(complete, 'DISCOVERY').complete).toBe(true);
  });

  it('阶段需求数只表示当前阶段分布，不表示完成数', () => {
    const counts = stageCounts([
      requirement({ phase: 'DELIVERY' }),
      requirement({ phase: 'DELIVERY' }),
      requirement({ phase: 'RELEASED' }),
    ]);
    expect(counts.find((stage) => stage.key === 'DELIVERY')?.count).toBe(2);
    expect(counts.find((stage) => stage.key === 'DISCOVERY')?.count).toBe(0);
  });
});
