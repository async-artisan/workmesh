import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RequirementTaskDetail } from '../api/resources';
import { stepDependencyGraph } from '../lib/workflowInstance';
import { TaskRelations } from './TaskRelations';

function task(id: string, workStatus = 'ACTIVE', instanceId = 'instance'): RequirementTaskDetail {
  return {
    id,
    stepKey: id,
    role: { key: 'dev', title: '开发' },
    responsibleUser: { id, email: `${id}@example.com` },
    version: 1,
    generation: 1,
    executionStatus: 'DONE',
    workStatus,
    currentClaimId: null,
    currentArtifactSetId: null,
    instanceId,
    artifactCount: 0,
    review: null,
  };
}
describe('task dependency handoff', () => {
  it('shows both directions with responsible people, treating paused predecessors as blocked', () => {
    const focus = vi.fn();
    const current = task('build');
    render(
      <TaskRelations
        task={current}
        tasks={[
          task('design', 'PAUSED'),
          current,
          task('qa'),
          task('design', 'ACTIVE', 'other-instance'),
        ]}
        graph={stepDependencyGraph({
          steps: [
            { key: 'design', roleKey: 'dev', deps: [] },
            { key: 'build', roleKey: 'dev', deps: ['design'] },
            { key: 'qa', roleKey: 'qa', deps: ['build'] },
          ],
        })}
        onFocus={focus}
      />,
    );
    expect(screen.getByText(/工作状态 PAUSED，需由有权人员解除/)).toBeInTheDocument();
    expect(screen.getByText(/qa@example.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'design' }));
    expect(focus).toHaveBeenCalledWith('design');
    expect(screen.getAllByRole('button', { name: 'design' })).toHaveLength(1);
  });
  it('does not interpret unavailable dependencies as an empty blocker list', () => {
    render(<TaskRelations task={task('build')} tasks={[]} onFocus={() => {}} />);
    expect(screen.getByText(/暂时无法确认阻塞对象/)).toBeInTheDocument();
    expect(screen.queryByText('流程未声明直接前置任务。')).not.toBeInTheDocument();
  });
});
