import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DependencyImpact } from '@workmesh/shared';
import { DependencyImpactHint } from './DependencyImpactHint';

const impact: DependencyImpact = {
  status: 'AVAILABLE',
  checkedAt: '2026-11-10T09:00:00Z',
  blocking: 8,
  readyAfterAction: 2,
  scenario: 'TASK_APPROVAL',
  reason: 'LAST_REQUIRED_SLOT',
};
describe('DependencyImpactHint', () => {
  it('distinguishes downstream reachability and dependency readiness with remaining gates', () => {
    render(<DependencyImpactHint impact={impact} />);
    expect(screen.getByText(/下游未完成任务：8 项/)).toHaveTextContent('2 项可满足前置任务条件');
    expect(screen.getByText(/领取前仍需检查输入/)).toBeInTheDocument();
  });
  it('never equates ACK or unknown information with task readiness', () => {
    const { rerender } = render(
      <DependencyImpactHint
        impact={{ ...impact, scenario: 'CHANGE_ACK', reason: 'ACK_ONLY', readyAfterAction: 0 }}
      />,
    );
    expect(screen.getByText(/确认知悉只记录收件/)).toBeInTheDocument();
    rerender(<DependencyImpactHint />);
    expect(screen.getByText('依赖影响尚未确认')).toBeInTheDocument();
  });
});
