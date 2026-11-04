import { PHASE_LABELS, WORK_STATUS_LABELS } from './labels';

/**
 * 需求流水线的唯一状态口径（阶段 / 执行状态 / 互斥统计 / 阶段进度 / 完成证据）。
 *
 * 服务端契约（核对于 2026-11-04，`apps/api/src/projects/requirements.service.ts` 的 list/viewOf）：
 * - `phase`: string，当前由业务写入 DISCOVERY / DEFINITION / DELIVERY / ACCEPTANCE / RELEASED / ARCHIVED；
 * - `workStatus`: WorkStatus 枚举 ACTIVE / BLOCKED / PAUSED / CANCELLED（Prisma schema）；
 * - 列表字段只有 id/projectId/seq/code/title/description/version/generation/phase/workStatus/createdAt/updatedAt；
 * - **没有** executionStatus、releasedAt/publishedAt、阶段完成记录、任务/评审完成数、阻塞原因、阶段历史。
 *
 * 因此本模块遵守：
 * 1. “当前阶段”和“执行状态”是两个维度：阶段来自 phase，执行状态来自 workStatus；
 * 2. “阶段有需求”只表示当前阶段分布，绝不表示该阶段已完成；
 * 3. 连接线/前置阶段只有在显式 `stageCompletion.completedPhases` 证据下才算“已完成”，
 *    仅凭 phase 越过只显示“已越过”（未来服务端若返回完成字段，组件可直接消费）；
 * 4. 缺少 workStatus / phase 时显示“状态待确认”，不推断为“进行中”或“已完成”；
 * 5. 可选 `executionStatus` 字段仅用于未来契约兼容（当前列表不返回）：只有显式 OPEN 才计“未开始”。
 */

export type PipelinePhase =
  'DISCOVERY' | 'DEFINITION' | 'DELIVERY' | 'ACCEPTANCE' | 'RELEASED' | 'ARCHIVED';

export interface PipelinePhaseDefinition {
  key: PipelinePhase;
  label: string;
  shortLabel: string;
}

function labelOfPhase(key: PipelinePhase): string {
  return PHASE_LABELS[key] ?? key;
}

export const PIPELINE_PHASE_DEFINITIONS: PipelinePhaseDefinition[] = (
  ['DISCOVERY', 'DEFINITION', 'DELIVERY', 'ACCEPTANCE', 'RELEASED', 'ARCHIVED'] as PipelinePhase[]
).map((key) => ({
  key,
  label: labelOfPhase(key),
  shortLabel:
    key === 'DISCOVERY'
      ? '发现'
      : key === 'DEFINITION'
        ? '定义'
        : key === 'DELIVERY'
          ? '交付'
          : key === 'ACCEPTANCE'
            ? '验收'
            : key === 'RELEASED'
              ? '发布'
              : '归档',
}));

const PHASE_INDEX = new Map(PIPELINE_PHASE_DEFINITIONS.map((stage, index) => [stage.key, index]));

export function normalizePhase(value: string | null | undefined): PipelinePhase | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return PHASE_INDEX.has(upper as PipelinePhase) ? (upper as PipelinePhase) : null;
}

export function phaseIndexOf(phase: PipelinePhase | null): number {
  if (!phase) return -1;
  return PHASE_INDEX.get(phase) ?? -1;
}

/** 阶段名称；未知/缺失统一显示“阶段待确认”，不伪装成某个已知阶段。 */
export function phaseLabelOf(value: string | null | undefined): string {
  const phase = normalizePhase(value);
  return phase ? labelOfPhase(phase) : '阶段待确认';
}

/** 服务端字段：当前由列表接口返回；未来可能出现的完成记录不在此假设内。 */
export interface PipelineRequirementSignals {
  phase?: string | null;
  workStatus?: string | null;
  /**
   * 列表接口当前不返回；仅在未来契约提供时使用。
   * 显式值只支持 OPEN（未开始）；其它显式值一律视为未知，不能猜成进行中。
   */
  executionStatus?: string | null;
  /**
   * executionStatus 字段的存在性。必须显式区分“字段缺失”和“字段存在但为 null/未知值”：
   * - true：服务端显式提供了该字段（值可能是 null 或未知枚举）；
   * - false：当前服务端契约没有该字段，workStatus=ACTIVE 可按“进行中”处理；
   * - undefined：旧调用方未声明；非 undefined 的值视为已提供；显式 null 也按“已提供”
   *   保守处理（API 适配层把缺失转成 null 时，调用方应显式传 false）。
   */
  executionStatusProvided?: boolean;
  /** 明确的阶段完成记录；当前列表接口不返回，缺失时绝不推断完成。 */
  stageCompletion?: { completedPhases?: string[] | null } | null;
}

export interface PipelinePhaseView {
  known: boolean;
  key: PipelinePhase | null;
  label: string;
  raw: string | null;
}

export type ExecutionStatusKind =
  'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'PAUSED' | 'CANCELLED' | 'UNKNOWN';

export type ExecutionStatusTone =
  'not-started' | 'active' | 'blocked' | 'paused' | 'cancelled' | 'unknown';

export interface ExecutionStatusView {
  kind: ExecutionStatusKind;
  label: string;
  tone: ExecutionStatusTone;
  description: string;
  /** 该状态来自哪个服务端字段（便于审计口径）。 */
  source: 'executionStatus' | 'workStatus' | 'none';
  /** 列表接口没有返回阻塞/暂停原因时为 true。 */
  reasonMissing: boolean;
}

export interface PipelineRequirementState {
  phase: PipelinePhaseView;
  execution: ExecutionStatusView;
  /** phase === RELEASED：这是业务阶段，不是执行状态。 */
  isReleased: boolean;
  /** phase === ARCHIVED：归档不等于发布。 */
  isArchived: boolean;
  /** 互斥统计分类。 */
  statKey: Exclude<PipelineStatKey, 'ALL'>;
  requirement: PipelineRequirementSignals;
}

const UNKNOWN_EXECUTION: ExecutionStatusView = {
  kind: 'UNKNOWN',
  label: '状态待确认',
  tone: 'unknown',
  description:
    '服务端没有提供可用的 workStatus，无法确认需求当前执行状态；缺少字段时不会推断为进行中。',
  source: 'none',
  reasonMissing: false,
};

/** executionStatus 字段的存在性与原始值。 */
function executionStatusPresence(signals: PipelineRequirementSignals): {
  provided: boolean;
  raw: string | null;
} {
  const raw = signals.executionStatus ?? null;
  const provided =
    signals.executionStatusProvided ??
    // 旧调用方：undefined 表示缺失；显式 null 按 provided=true 保守处理。
    signals.executionStatus !== undefined;
  return { provided, raw };
}

export function describeExecutionStatus(signals: PipelineRequirementSignals): ExecutionStatusView {
  const workStatus = signals.workStatus?.trim().toUpperCase() ?? '';
  if (workStatus === 'CANCELLED')
    return {
      kind: 'CANCELLED',
      label: WORK_STATUS_LABELS.CANCELLED ?? '已取消',
      tone: 'cancelled',
      description: '服务端返回 workStatus=CANCELLED：该需求已取消，不再参与执行。',
      source: 'workStatus',
      reasonMissing: false,
    };
  if (workStatus === 'BLOCKED')
    return {
      kind: 'BLOCKED',
      label: WORK_STATUS_LABELS.BLOCKED ?? '阻塞',
      tone: 'blocked',
      description:
        '服务端返回 workStatus=BLOCKED：需求阻塞，解除前不能继续执行；当前列表接口没有返回阻塞原因。',
      source: 'workStatus',
      reasonMissing: true,
    };
  if (workStatus === 'PAUSED')
    return {
      kind: 'PAUSED',
      label: WORK_STATUS_LABELS.PAUSED ?? '暂停',
      tone: 'paused',
      description: '服务端返回 workStatus=PAUSED：需求暂停；当前列表接口没有返回暂停原因。',
      source: 'workStatus',
      reasonMissing: true,
    };
  if (workStatus !== 'ACTIVE') return UNKNOWN_EXECUTION;

  const { provided, raw } = executionStatusPresence(signals);
  const executionStatus = raw?.trim().toUpperCase() ?? '';

  // 当前服务端契约没有 executionStatus：ACTIVE 仍然可按“进行中”展示。
  if (!provided) {
    return {
      kind: 'IN_PROGRESS',
      label: '进行中',
      tone: 'active',
      description:
        '服务端返回 workStatus=ACTIVE，且当前列表契约不提供 executionStatus：需求处于活动状态；这不代表阶段工作已经完成。',
      source: 'workStatus',
      reasonMissing: false,
    };
  }

  // 已知执行状态：只有 OPEN 在现有契约中具备明确语义（未来新增枚举须先更新映射）。
  if (executionStatus === 'OPEN')
    return {
      kind: 'NOT_STARTED',
      label: '未开始',
      tone: 'not-started',
      description: '服务端显式返回 executionStatus=OPEN：尚未进入执行。',
      source: 'executionStatus',
      reasonMissing: false,
    };

  if (executionStatus === '') {
    return {
      kind: 'UNKNOWN',
      label: '状态待确认',
      tone: 'unknown',
      description:
        '服务端显式返回 executionStatus=null/空值，无法映射为已知执行状态；缺失与显式空值都被当作无法确认，不推断为进行中。',
      source: 'executionStatus',
      reasonMissing: false,
    };
  }

  // 显式未知枚举：绝不猜测为新状态或归入进行中。
  return {
    kind: 'UNKNOWN',
    label: '状态待确认',
    tone: 'unknown',
    description: `服务端显式返回未知 executionStatus“${raw}”，前端不猜测服务端新增枚举，因此无法确认执行状态。`,
    source: 'executionStatus',
    reasonMissing: false,
  };
}

export type PipelineStatKey =
  | 'ALL'
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'RELEASED'
  | 'ARCHIVED'
  | 'UNKNOWN';

export interface PipelineStatDefinition {
  key: Exclude<PipelineStatKey, 'ALL'>;
  label: string;
  /** 统计口径说明（显示在页面上，避免数字含义靠猜）。 */
  description: string;
}

/**
 * 互斥统计分类的定义与顺序。每个需求只落入一个分类，合计必须等于全部需求。
 * - 已取消/阻塞/暂停优先（明确的执行中断状态）；
 * - 已发布/已归档来自业务阶段 phase，与执行状态不是同一维度；
 * - 未开始只在服务端显式给出 executionStatus=OPEN 时成立；
 * - 其余显式 ACTIVE 才算进行中；缺字段/未知阶段进入“状态待确认”。
 */
export const PIPELINE_STAT_DEFINITIONS: PipelineStatDefinition[] = [
  {
    key: 'NOT_STARTED',
    label: '未开始',
    description:
      '仅在服务端显式返回已知 executionStatus=OPEN 时计入；显式 null/未知枚举不会计入未开始，而是进入状态待确认。',
  },
  {
    key: 'IN_PROGRESS',
    label: '进行中',
    description:
      'workStatus=ACTIVE，且当前契约未提供 executionStatus（或提供已知可执行状态），并且不属于已发布/已归档阶段。',
  },
  {
    key: 'BLOCKED',
    label: '阻塞',
    description: 'workStatus=BLOCKED；不计入进行中。',
  },
  {
    key: 'PAUSED',
    label: '暂停',
    description: 'workStatus=PAUSED；不计入进行中。',
  },
  {
    key: 'CANCELLED',
    label: '已取消',
    description: 'workStatus=CANCELLED；优先于其它分类。',
  },
  {
    key: 'RELEASED',
    label: '已发布（阶段）',
    description: 'phase=RELEASED 且 workStatus=ACTIVE；按业务阶段统计，不是执行状态。',
  },
  {
    key: 'ARCHIVED',
    label: '已归档（阶段）',
    description: 'phase=ARCHIVED 且 workStatus=ACTIVE；归档不等于已发布。',
  },
  {
    key: 'UNKNOWN',
    label: '状态待确认',
    description: '缺少/未知 workStatus，或阶段无法识别；不会归入进行中。',
  },
];

export function pipelineStatKeyOf(
  signals: PipelineRequirementSignals,
): Exclude<PipelineStatKey, 'ALL'> {
  const phase = normalizePhase(signals.phase);
  const execution = describeExecutionStatus(signals);

  if (execution.kind === 'CANCELLED') return 'CANCELLED';
  if (execution.kind === 'BLOCKED') return 'BLOCKED';
  if (execution.kind === 'PAUSED') return 'PAUSED';
  if (execution.kind === 'UNKNOWN') return 'UNKNOWN';
  if (!phase) return 'UNKNOWN';
  if (phase === 'RELEASED') return 'RELEASED';
  if (phase === 'ARCHIVED') return 'ARCHIVED';
  if (execution.kind === 'NOT_STARTED') return 'NOT_STARTED';
  return 'IN_PROGRESS';
}

export interface PipelineStats {
  total: number;
  counts: Record<Exclude<PipelineStatKey, 'ALL'>, number>;
  /** 互斥分类合计；必须等于 total。 */
  sum: number;
}

export function computePipelineStats(
  requirements: ReadonlyArray<PipelineRequirementSignals>,
): PipelineStats {
  const counts: Record<Exclude<PipelineStatKey, 'ALL'>, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    PAUSED: 0,
    CANCELLED: 0,
    RELEASED: 0,
    ARCHIVED: 0,
    UNKNOWN: 0,
  };
  for (const requirement of requirements) counts[pipelineStatKeyOf(requirement)] += 1;
  const sum = Object.values(counts).reduce((total, value) => total + value, 0);
  return { total: requirements.length, counts, sum };
}

export function describeRequirementState(
  signals: PipelineRequirementSignals,
): PipelineRequirementState {
  const phaseKey = normalizePhase(signals.phase);
  return {
    phase: {
      known: phaseKey !== null,
      key: phaseKey,
      label: phaseKey ? labelOfPhase(phaseKey) : '阶段待确认',
      raw: signals.phase ?? null,
    },
    execution: describeExecutionStatus(signals),
    isReleased: phaseKey === 'RELEASED',
    isArchived: phaseKey === 'ARCHIVED',
    statKey: pipelineStatKeyOf(signals),
    requirement: signals,
  };
}

export type StageProgressState = 'complete' | 'passed' | 'current' | 'pending' | 'unknown';

function explicitCompletedStages(signals: PipelineRequirementSignals): Set<string> {
  const completed = signals.stageCompletion?.completedPhases;
  return new Set(Array.isArray(completed) ? completed.map((phase) => phase.toUpperCase()) : []);
}

/**
 * 单条需求的阶段进度：
 * - current：当前阶段；
 * - complete：服务端显式提供该阶段完成记录；
 * - passed：phase 已越过该阶段，但没有完成证据，只显示“已越过”；
 * - pending：后续阶段，显示“待进入”；
 * - unknown：phase 缺失/未知。
 */
export function requirementStageProgress(
  signals: PipelineRequirementSignals,
  stage: PipelinePhase,
): StageProgressState {
  const phase = normalizePhase(signals.phase);
  const target = phaseIndexOf(stage);
  const current = phaseIndexOf(phase);
  if (current < 0 || target < 0) return 'unknown';
  if (target === current) return 'current';
  if (explicitCompletedStages(signals).has(stage)) return 'complete';
  if (target < current) return 'passed';
  return 'pending';
}

export function stageProgressLabel(state: StageProgressState): string {
  switch (state) {
    case 'complete':
      return '已完成（服务端完成证据）';
    case 'passed':
      return '已越过';
    case 'current':
      return '当前';
    case 'pending':
      return '待进入';
    default:
      return '阶段待确认';
  }
}

export function stageProgressDescription(state: StageProgressState): string {
  switch (state) {
    case 'complete':
      return '已完成：服务端明确提供了该阶段的完成记录。';
    case 'passed':
      return '已越过：仅表示当前需求处于更靠后的阶段，不代表该阶段的工作已经完成。';
    case 'current':
      return '当前：需求当前处于该阶段。';
    case 'pending':
      return '待进入：需求尚未进入该阶段。';
    default:
      return '阶段待确认：服务端没有提供可用的阶段信息。';
  }
}

export interface StageConnectorCompletion {
  /** 只有所有相关需求都有明确的阶段完成记录时才为 true。 */
  complete: boolean;
  evidenceCount: number;
  total: number;
  reason: 'empty' | 'no-evidence' | 'partial' | 'complete';
}

/**
 * 阶段连接线的完成判定：当前接口没有阶段完成字段，因此正常情况下恒为 false。
 * 仅当每条需求都显式提供 `stageCompletion.completedPhases` 包含该阶段时，才允许标记完成。
 */
export function stageConnectorCompletion(
  requirements: ReadonlyArray<PipelineRequirementSignals>,
  stage: PipelinePhase,
): StageConnectorCompletion {
  if (requirements.length === 0)
    return { complete: false, evidenceCount: 0, total: 0, reason: 'empty' };
  const evidenceCount = requirements.filter((requirement) =>
    explicitCompletedStages(requirement).has(stage),
  ).length;
  if (evidenceCount === 0)
    return {
      complete: false,
      evidenceCount,
      total: requirements.length,
      reason: 'no-evidence',
    };
  if (evidenceCount < requirements.length)
    return {
      complete: false,
      evidenceCount,
      total: requirements.length,
      reason: 'partial',
    };
  return { complete: true, evidenceCount, total: requirements.length, reason: 'complete' };
}

export function stageCounts(
  requirements: ReadonlyArray<PipelineRequirementSignals>,
): Array<PipelinePhaseDefinition & { count: number }> {
  return PIPELINE_PHASE_DEFINITIONS.map((stage) => ({
    ...stage,
    count: requirements.filter((requirement) => normalizePhase(requirement.phase) === stage.key)
      .length,
  }));
}
