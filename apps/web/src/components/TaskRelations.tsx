import type { RequirementTaskDetail } from '../api/resources';
import type { StepDependencyGraph } from '../lib/workflowInstance';

export function TaskRelations({
  task,
  tasks,
  graph,
  onFocus,
}: {
  task: RequirementTaskDetail;
  tasks: RequirementTaskDetail[];
  graph?: StepDependencyGraph;
  onFocus: (id: string) => void;
}) {
  const info = graph?.steps[task.stepKey];
  if (!info || !info.isDependencyGraphComplete)
    return <p>任务依赖读取不完整，暂时无法确认阻塞对象。</p>;
  const related = tasks.filter((value) => value.instanceId === task.instanceId);
  const predecessors = info.dependencyKeys.map((key) => ({
    key,
    task: related.find((value) => value.stepKey === key),
  }));
  const following = related.filter((value) =>
    graph?.steps[value.stepKey]?.dependencyKeys.includes(task.stepKey),
  );
  return (
    <section aria-label="任务依赖关系">
      <p>
        <strong>被哪些前置任务阻塞</strong>
      </p>
      {predecessors.length === 0 ? (
        <p>流程未声明直接前置任务。</p>
      ) : (
        <ul>
          {predecessors.map(({ key, task: previous }) => (
            <li key={key}>
              {previous ? (
                <>
                  <button className="ghost" onClick={() => onFocus(previous.id)}>
                    {previous.stepDisplayName?.trim() || previous.stepKey}
                  </button>
                  · 责任人 {previous.responsibleUser.email} ·{' '}
                  {previous.executionStatus === 'DONE' && previous.workStatus === 'ACTIVE'
                    ? '已完成'
                    : previous.workStatus === 'ACTIVE'
                      ? '等待该责任人完成交付与人工验收'
                      : `工作状态 ${previous.workStatus}，需由有权人员解除后继续`}
                </>
              ) : (
                `${key}：没有取得对应任务，请联系项目管理员核对实例。`
              )}
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>本任务影响的直接后续任务</strong>
      </p>
      {following.length === 0 ? (
        <p>流程未声明直接后续任务。</p>
      ) : (
        <ul>
          {following.map((next) => (
            <li key={next.id}>
              <button className="ghost" onClick={() => onFocus(next.id)}>
                {next.stepDisplayName?.trim() || next.stepKey}
              </button>{' '}
              · 责任人 {next.responsibleUser.email}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
