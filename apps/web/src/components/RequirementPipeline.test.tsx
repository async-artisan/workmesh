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
    expect(screen.getByRole('heading', { name: /收尾 · 已完成 3/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /执行中 \/ 阻塞 0/ })).toBeInTheDocument();
  });

  it('keeps an ACTIVE but OPEN task ready to claim', () => {
    render(
      <RequirementPipeline
        tasks={[
          { id: 'open', stepKey: 'implement', executionStatus: 'OPEN', workStatus: 'ACTIVE' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: /无依赖 · 可立即领 1/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /执行中 \/ 阻塞 0/ })).toBeInTheDocument();
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
      within(screen.getByRole('button', { name: /Review task/ })).getByText('工作中'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Blocked task/ })).getByText('阻塞'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Paused task/ })).getByText('阻塞'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Cancelled task/ })).getByText('跳过'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /无依赖 · 可立即领 0/ })).toBeInTheDocument();
  });
});
