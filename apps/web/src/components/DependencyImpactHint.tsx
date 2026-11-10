import type { DependencyImpact } from '@workmesh/shared';

export function DependencyImpactHint({ impact }: { impact?: DependencyImpact }) {
  if (!impact || impact.status !== 'AVAILABLE')
    return <p className="wb-card-owner">依赖影响尚未确认</p>;
  const effect =
    impact.scenario === 'CHANGE_ACK'
      ? '确认知悉只记录收件，任务仍需按提示调整。'
      : impact.scenario === 'BASELINE_PUBLICATION'
        ? '发布后需重新检查基线与输入。'
        : impact.reason === 'OTHER_SLOTS_PENDING'
          ? '仍有其他审批槽待决定，本次签字不会独立解锁任务。'
          : impact.reason === 'STALE_SUBJECT' || impact.reason === 'NOT_ACTIONABLE'
            ? '当前主体或评审对象不满足推进条件。'
            : impact.scenario === 'TASK_COMPLETION'
              ? `本任务完成后，${impact.readyAfterAction ?? 0} 项可满足前置任务条件。`
              : `本次评审完成后，${impact.readyAfterAction ?? 0} 项可满足前置任务条件。`;
  return (
    <p className="wb-card-owner">
      {impact.scenario === 'CHANGE_ACK' || impact.scenario === 'BASELINE_PUBLICATION'
        ? '关联未完成任务'
        : '下游未完成任务'}
      ：{impact.blocking} 项。{effect}
      {impact.readyAfterAction !== null &&
        impact.readyAfterAction > 0 &&
        '领取前仍需检查输入、工作状态与责任权限。'}
    </p>
  );
}
