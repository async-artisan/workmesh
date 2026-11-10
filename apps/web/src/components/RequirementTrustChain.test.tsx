import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { RequirementTrustChain as Chain } from '@workmesh/shared';
import { RequirementTrustChain } from './RequirementTrustChain';

const chain: Chain = {
  scope: 'FORMAL_FACT_CHAIN',
  checkedAt: '2026-11-10T01:00:00Z',
  requirementGeneration: 4,
  status: 'GAPS',
  visibility: 'FULL',
  baselines: [
    { kind: 'UNDERSTANDING', state: 'CURRENT', seq: 1, title: '需求理解' },
    { kind: 'PRD', state: 'CURRENT', seq: 3, title: '产品需求 3' },
  ],
  tasks: [
    {
      taskId: 'task',
      taskGeneration: 5,
      stepLabel: '后端实现',
      state: 'PENDING',
      baselineRelation: 'CURRENT',
      artifactSetId: 'set',
      snapshotId: 'snapshot',
      reviewId: 'review',
      gapCodes: ['CODE_EVIDENCE_MISSING'],
    },
  ],
  acceptance: [{ key: 'A1', taskIds: ['task'], acceptedTaskIds: [] }],
  gaps: [{ code: 'CODE_EVIDENCE_MISSING', taskId: 'task' }],
  timeline: [
    {
      id: 'delivery',
      kind: 'DELIVERY',
      at: '2026-11-10T01:00:00Z',
      source: 'AGENT_SUBMITTED',
      applicability: 'CURRENT',
      label: '后端实现',
      actors: [{ kind: 'AGENT', userId: 'agent', label: 'dev@example.test' }],
      taskId: 'task',
      taskGeneration: 5,
      requirementGeneration: 4,
    },
    {
      id: 'decision',
      kind: 'DECISION',
      at: '2026-11-09T01:00:00Z',
      source: 'HUMAN_SIGNED',
      applicability: 'REVOKED',
      label: '旧交付',
      decision: 'APPROVE',
      actors: [{ kind: 'HUMAN', userId: 'human', label: 'owner@example.test' }],
      reviewId: 'review-old',
    },
    {
      id: 'withdraw',
      kind: 'WITHDRAWAL',
      at: '2026-11-09T02:00:00Z',
      source: 'PLATFORM_FACT',
      applicability: 'WITHDRAWN',
      label: 'PRD 2',
      actors: [],
    },
  ],
};

describe('requirement trust chain', () => {
  it('shows explicit current gaps with task and timeline actions without describing Agent reports as approval', () => {
    const onTask = vi.fn();
    const onTimeline = vi.fn();
    render(<RequirementTrustChain chain={chain} onTask={onTask} onTimeline={onTimeline} />);
    expect(screen.getByText('存在证据缺口')).toBeInTheDocument();
    expect(screen.getByText(/当前需求第 4 代/)).toBeInTheDocument();
    expect(screen.getByText(/历史批准不代表当前有效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '定位 后端实现' }));
    expect(onTask).toHaveBeenCalledWith('task');
    fireEvent.click(screen.getByRole('button', { name: '展开信任链时间线（3）' }));
    expect(onTimeline).toHaveBeenCalledOnce();
  });
  it('renders formal fact provenance, unknown signer and revoked historical approval, with functional filters and deep links', () => {
    render(
      <MemoryRouter>
        <RequirementTrustChain chain={chain} mode="timeline" onTask={vi.fn()} />
      </MemoryRouter>,
    );
    const timeline = screen.getByRole('list', { name: '正式事实时间线' });
    expect(within(timeline).getByText(/Agent 提交/)).toBeInTheDocument();
    expect(within(timeline).getByText(/已撤销 · HUMAN 签字/)).toBeInTheDocument();
    expect(within(timeline).getByText('撤回操作人未记录；不推断签字人')).toBeInTheDocument();
    expect(within(timeline).getByRole('link', { name: '查看评审与证据' })).toHaveAttribute(
      'href',
      '/reviews/review-old',
    );
    fireEvent.change(screen.getByLabelText('信任链事件类型'), { target: { value: 'DECISION' } });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(1);
    expect(within(timeline).queryByText(/Agent 提交/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('信任链关联状态'), { target: { value: 'CURRENT' } });
    expect(screen.getByText('当前筛选下没有已登记事实。')).toBeInTheDocument();
  });
  it('does not infer a complete chain from an old response or partial visibility', () => {
    const view = render(<RequirementTrustChain onTask={vi.fn()} />);
    expect(screen.getByText(/当前平台未返回信任链诊断/)).toBeInTheDocument();
    view.rerender(
      <RequirementTrustChain
        chain={{ ...chain, visibility: 'PARTIAL', status: 'UNAVAILABLE' }}
        onTask={vi.fn()}
      />,
    );
    expect(screen.getByText('部分资料待核对')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('隐藏记录不会被计为已完成');
  });
});
