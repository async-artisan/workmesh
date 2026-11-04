import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequirementPipeline } from './RequirementPipeline';

describe('RequirementPipeline execution progress', () => {
  it('shows completed tasks as done while their work status remains ACTIVE', () => {
    render(
      <RequirementPipeline
        tasks={['implement', 'verify', 'release'].map((stepKey) => ({
          id: stepKey,
          stepKey,
          executionStatus: 'DONE',
          workStatus: 'ACTIVE',
        }))}
      />,
    );
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /已完成 3/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /执行中 \/ 阻塞 0/ })).toBeInTheDocument();
  });

  it('未完成但没有依赖信息时显示「状态待确认」，不再写「可立即领取」', () => {
    render(
      <RequirementPipeline
        tasks={[
          { id: 'open', stepKey: 'implement', executionStatus: 'OPEN', workStatus: 'ACTIVE' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: /可立即领取 0/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /等待中（前置 \/ 审批 \/ 待确认） 1/ }),
    ).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /implement/ });
    expect(within(card).getByText('状态待确认')).toBeInTheDocument();
    expect(within(card).getByText(/依赖信息不可用/)).toBeInTheDocument();
    expect(screen.queryByText(/无依赖 · 可立即领/)).not.toBeInTheDocument();
  });

  it('只有直接前置步骤全部完成时才计入「可立即领取」', () => {
    render(
      <RequirementPipeline
        tasks={[
          {
            id: 'impl',
            stepKey: 'implement',
            executionStatus: 'OPEN',
            workStatus: 'ACTIVE',
            dependsOnStepKeys: ['prd'],
            doneStepKeys: ['prd'],
          },
          {
            id: 'verify',
            stepKey: 'verify',
            executionStatus: 'OPEN',
            workStatus: 'ACTIVE',
            dependsOnStepKeys: ['implement'],
            doneStepKeys: ['prd'],
          },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: /可立即领取 1/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /^implement，状态：可立即领取/ })).getByText(
        '可立即领取',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /^verify，状态：等待前置任务/ })).getByText(
        '等待前置任务',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /^verify，状态：等待前置任务/ })).getByText(
        /#implement/,
      ),
    ).toBeInTheDocument();
  });

  it('keeps review work active and respects blocked, paused and cancelled work', () => {
    render(
      <RequirementPipeline
        tasks={[
          {
            id: 'review',
            stepKey: 'implement',
            title: 'Review task',
            executionStatus: 'REVIEW_PENDING',
            workStatus: 'ACTIVE',
          },
          {
            id: 'blocked',
            stepKey: 'implement',
            title: 'Blocked task',
            executionStatus: 'OPEN',
            workStatus: 'BLOCKED',
          },
          {
            id: 'paused',
            stepKey: 'implement',
            title: 'Paused task',
            executionStatus: 'OPEN',
            workStatus: 'PAUSED',
          },
          {
            id: 'cancelled',
            stepKey: 'implement',
            title: 'Cancelled task',
            executionStatus: 'OPEN',
            workStatus: 'CANCELLED',
          },
        ]}
      />,
    );
    expect(
      within(screen.getByRole('button', { name: /Review task/ })).getByText('等待审批'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Blocked task/ })).getByText('阻塞 / 冻结'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Paused task/ })).getByText('暂停 / 冻结'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Cancelled task/ })).getAllByText('已取消').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /可立即领取 0/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /已完成 1/ })).toBeInTheDocument();
  });

  it('任务卡是原生可聚焦按钮，并带有可访问名称', () => {
    let clicked = '';
    render(
      <RequirementPipeline
        tasks={[
          {
            id: 'task-1',
            stepKey: 'implement',
            title: '实现登录',
            executionStatus: 'OPEN',
            workStatus: 'ACTIVE',
            dependsOnStepKeys: [],
            doneStepKeys: [],
          },
        ]}
        onTaskClick={(task) => {
          clicked = task.id;
        }}
      />,
    );
    const card = screen.getByRole('button', { name: /实现登录，状态：可立即领取/ });
    expect(card.tagName).toBe('BUTTON');
    card.focus();
    expect(card).toHaveFocus();
    card.click();
    expect(clicked).toBe('task-1');
  });

  it('缺少 workStatus 的任务卡显示「状态待确认」，不会显示可立即领取', () => {
    render(
      <RequirementPipeline
        tasks={[
          {
            id: 'task-2',
            stepKey: 'implement',
            title: '缺少工作状态',
            executionStatus: 'OPEN',
            dependsOnStepKeys: [],
            doneStepKeys: [],
          },
        ]}
      />,
    );
    const card = screen.getByRole('button', { name: /缺少工作状态，状态：状态待确认/ });
    expect(within(card).getByText('状态待确认')).toBeInTheDocument();
    expect(within(card).queryByText('可立即领取')).not.toBeInTheDocument();
  });
});
