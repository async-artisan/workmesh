import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectPipelineOverview, type PipelineRequirement } from './ProjectPipelineOverview';

function req(overrides: Partial<PipelineRequirement> = {}): PipelineRequirement {
  const id = overrides.id ?? 'req-1';
  return {
    id,
    code: overrides.code ?? `DEMO-${id}`,
    title: overrides.title ?? `需求 ${id}`,
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    ...overrides,
  };
}

function renderOverview(
  requirements: PipelineRequirement[],
  props: { onSelectRequirement?: (requirement: PipelineRequirement) => void } = {},
) {
  return render(<ProjectPipelineOverview requirements={requirements} {...props} />);
}

describe('ProjectPipelineOverview（阶段时间线 / 状态拆分 / 统计口径）', () => {
  it('阶段节点显示「当前阶段需求数」，没有完成证据时连接线保持中性', () => {
    const { container } = renderOverview([
      req({ id: 'a', phase: 'DELIVERY', workStatus: 'ACTIVE' }),
      req({ id: 'b', phase: 'DELIVERY', workStatus: 'BLOCKED' }),
    ]);

    const deliveryStage = screen.getByRole('button', {
      name: /交付：当前阶段需求数 2；未筛选；阶段完成证据：阶段完成状态待确认/,
    });
    expect(deliveryStage).toBeInTheDocument();
    expect(screen.getAllByText('当前阶段需求数 2').length).toBeGreaterThan(0);

    const connectors = container.querySelectorAll('.pipeline-overview__connector');
    expect(connectors.length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('.pipeline-overview__connector[data-complete="true"]'),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole('img', { name: /阶段完成状态待确认，连接线不代表阶段已完成/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/当前接口没有阶段完成记录，完成状态待确认，连接线保持中性/),
    ).toBeInTheDocument();
  });

  it('有明确完成记录时连接线才显示完成，并在可访问名称中说明证据', () => {
    const completed = { completedPhases: ['DISCOVERY', 'DEFINITION', 'DELIVERY'] };
    const { container } = renderOverview([
      req({ id: 'a', phase: 'DEFINITION', stageCompletion: completed }),
      req({ id: 'b', phase: 'ACCEPTANCE', stageCompletion: completed }),
    ]);

    const discoveryConnector = container.querySelectorAll('.pipeline-overview__connector')[0];
    expect(discoveryConnector).toHaveAttribute('data-complete', 'true');
    expect(screen.getAllByRole('img', { name: /存在服务端阶段完成记录/ }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/当前数据提供了阶段完成记录/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /需求发现：当前阶段需求数 0；未筛选；阶段完成证据：服务端已记录该阶段完成/,
      }),
    ).toBeInTheDocument();
  });

  it('已发布需求不会自动让前置阶段显示已完成，阶段与执行状态分开显示', () => {
    renderOverview([
      req({ id: 'a', phase: 'RELEASED', workStatus: 'ACTIVE', title: '已发布需求' }),
    ]);

    const card = screen.getByRole('button', { name: /打开需求 DEMO-a 已发布需求/ });
    expect(card).toHaveAccessibleName(/当前阶段：已发布/);
    expect(card).toHaveAccessibleName(/执行状态：进行中/);
    expect(within(card).getByText('当前阶段：已发布')).toBeInTheDocument();
    expect(within(card).getByText('执行状态：进行中')).toBeInTheDocument();
    expect(within(card).getByText(/「已发布」是业务阶段/)).toBeInTheDocument();

    const progress = card.querySelector('.pipeline-overview__progress');
    expect(progress).not.toBeNull();
    const states = Array.from(progress?.querySelectorAll('i') ?? [], (element) =>
      element.getAttribute('data-state'),
    );
    expect(states).toContain('current');
    expect(states).toContain('passed');
    expect(states).not.toContain('complete');
  });

  it('未知阶段显示阶段待确认，并提示未计入时间线、计入状态待确认', () => {
    renderOverview([req({ id: 'x', phase: 'SOMETHING_NEW', workStatus: 'ACTIVE' })]);

    const card = screen.getByRole('button', { name: /打开需求 DEMO-x/ });
    expect(within(card).getByText('当前阶段：阶段待确认')).toBeInTheDocument();
    expect(within(card).getByText(/统计计入“状态待确认”/)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 条需求阶段未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /状态待确认：1 条/ })).toBeInTheDocument();
  });

  it('空项目显示真正的空态', () => {
    renderOverview([]);
    expect(screen.getByText('当前项目还没有需求。')).toBeInTheDocument();
  });

  it('混合统计互斥分类可筛选，统计数字与列表结果一致', () => {
    const requirements = [
      req({ id: 'in-progress', title: '进行中需求', phase: 'DELIVERY', workStatus: 'ACTIVE' }),
      req({ id: 'blocked', title: '阻塞需求', phase: 'DELIVERY', workStatus: 'BLOCKED' }),
      req({ id: 'paused', title: '暂停需求', phase: 'ACCEPTANCE', workStatus: 'PAUSED' }),
      req({ id: 'cancelled', title: '取消需求', phase: 'DISCOVERY', workStatus: 'CANCELLED' }),
      req({ id: 'released', title: '发布需求', phase: 'RELEASED', workStatus: 'ACTIVE' }),
      req({ id: 'archived', title: '归档需求', phase: 'ARCHIVED', workStatus: 'ACTIVE' }),
      req({ id: 'unknown', title: '未知需求', phase: 'DEFINITION', workStatus: null }),
      req({
        id: 'not-started',
        title: '未开始需求',
        phase: 'DELIVERY',
        workStatus: 'ACTIVE',
        executionStatus: 'OPEN',
      }),
    ];
    renderOverview(requirements);

    expect(screen.getByRole('button', { name: /全部需求：8 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /阻塞：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /暂停：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已取消：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已发布（阶段）：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已归档（阶段）：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /状态待确认：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未开始：1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /进行中：1 条/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /阻塞：1 条/ }));
    expect(screen.getByText('阻塞需求')).toBeInTheDocument();
    expect(screen.queryByText('进行中需求')).not.toBeInTheDocument();
    expect(screen.queryByText('暂停需求')).not.toBeInTheDocument();
    expect(screen.queryByText('取消需求')).not.toBeInTheDocument();
    expect(screen.getByLabelText('当前显示 1 条')).toBeInTheDocument();
  });

  it('阶段节点、连接线和卡片都有明确的可访问名称，并支持键盘聚焦', () => {
    renderOverview([req({ id: 'b', phase: 'DELIVERY', workStatus: 'BLOCKED', title: '阻塞卡片' })]);

    expect(
      screen.getByRole('button', {
        name: /交付：当前阶段需求数 1；未筛选；阶段完成证据：阶段完成状态待确认/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('img', { name: /连接线：阶段完成状态待确认/ }).length,
    ).toBeGreaterThan(0);

    const card = screen.getByRole('button', {
      name: /打开需求 DEMO-b 阻塞卡片；当前阶段：交付；执行状态：阻塞/,
    });
    expect(
      within(card).getByText('阻塞/暂停原因由服务端记录提供，当前需求列表接口未返回原因。'),
    ).toBeInTheDocument();
    card.focus();
    expect(card).toHaveFocus();

    const blockedStat = screen.getByRole('button', { name: /阻塞：1 条/ });
    expect(blockedStat.getAttribute('aria-label')).toContain('口径：');
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
  });
});
