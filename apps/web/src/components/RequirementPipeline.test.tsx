import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequirementPipeline } from './RequirementPipeline';

afterEach(() => {
  vi.restoreAllMocks();
});
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

  it('未完成但没有依赖信息时显示「状态待确认」，不再写「前置任务已完成」', () => {
    render(
      <RequirementPipeline
        tasks={[
          { id: 'open', stepKey: 'implement', executionStatus: 'OPEN', workStatus: 'ACTIVE' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: /前置任务已完成 0/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /等待中（前置 \/ 审批 \/ 待确认） 1/ }),
    ).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /implement/ });
    expect(within(card).getByText('状态待确认')).toBeInTheDocument();
    expect(within(card).getByText(/依赖信息不可用/)).toBeInTheDocument();
    expect(screen.queryByText(/无依赖 · 可立即领/)).not.toBeInTheDocument();
  });

  it('只有直接前置步骤全部完成时才计入「前置任务已完成」', () => {
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
    expect(screen.getByRole('heading', { name: /前置任务已完成 1/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /^implement，状态：前置任务已完成/ })).getByText(
        '前置任务已完成',
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
    expect(screen.getByRole('heading', { name: /前置任务已完成 0/ })).toBeInTheDocument();
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
    const card = screen.getByRole('button', { name: /实现登录，状态：前置任务已完成/ });
    expect(card.tagName).toBe('BUTTON');
    card.focus();
    expect(card).toHaveFocus();
    card.click();
    expect(clicked).toBe('task-1');
  });

  it('缺少 workStatus 的任务卡显示「状态待确认」，不会显示前置任务已完成', () => {
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
    expect(within(card).queryByText('前置任务已完成')).not.toBeInTheDocument();
  });
});

describe('RequirementPipeline 首屏折叠 / 本地头像 / 任务去重', () => {
  const tasks = [
    {
      id: 't-1',
      stepKey: 'impl-fe',
      title: '前端实现',
      role: 'frontend',
      executionStatus: 'DONE',
      workStatus: 'ACTIVE',
    },
    {
      id: 't-2',
      stepKey: 'verify',
      title: '测试验证',
      role: 'qa',
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      dependsOnStepKeys: ['impl-fe'],
      doneStepKeys: ['impl-fe'],
    },
  ];

  it('collapsible 默认只渲染一行阶段进度 + 下一步，展开后才渲染团队视图', () => {
    render(<RequirementPipeline collapsible tasks={tasks} nextAction="完成验收测试" />);

    const toggle = screen.getByRole('button', { name: '展开团队视图' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const detailId = toggle.getAttribute('aria-controls');
    expect(detailId).toBeTruthy();
    const detail = document.getElementById(detailId!);
    expect(detail).not.toBeNull();
    expect(detail).toHaveAttribute('hidden');

    // 折叠时摘要行可见：阶段进度 + 下一步；任务卡不在 DOM 中。
    expect(screen.getByText('阶段进度')).toBeInTheDocument();
    expect(screen.getByText('下一步')).toBeInTheDocument();
    expect(screen.getByText('完成验收测试')).toBeInTheDocument();
    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /前端实现，状态：已完成/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('收起团队视图');
    expect(document.getElementById(detailId!)).not.toHaveAttribute('hidden');
    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /前端实现，状态：已完成/ })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(0);
  });

  it('团队视图切换使用原生按钮，保留 Enter 与 Space 键盘激活入口', () => {
    render(<RequirementPipeline collapsible tasks={tasks} />);
    const toggle = screen.getByRole('button', { name: '展开团队视图' });
    expect(toggle).toHaveAttribute('type', 'button');

    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(toggle, { key: 'Enter', code: 'Enter' });
    // JSDOM 不会替浏览器合成原生按钮的 click，这里显式触发相同的激活结果。
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(toggle, { key: ' ', code: 'Space' });
    fireEvent.keyUp(toggle, { key: ' ', code: 'Space' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('重复分配给两个阶段的任务只渲染一次，统计分母同源', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shared = {
      id: 'dup-1',
      stepKey: 'prd',
      title: '产品 PRD',
      role: 'product',
      executionStatus: 'DONE',
      workStatus: 'ACTIVE',
    };
    render(
      <RequirementPipeline
        collapsible
        phases={[
          {
            id: 'discovery',
            label: '需求发现',
            shortLabel: '发现',
            role: 'product',
            tasks: [shared],
          },
          {
            id: 'definition',
            label: '方案定义',
            shortLabel: '定义',
            role: 'product',
            tasks: [shared],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开团队视图' }));

    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(1);
    // 任务统计的分母来自去重后的任务列表（1/1），阶段摘要单独计数（1/2）。
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    const duplicateKeyWarnings = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes('same key'));
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('角色头像使用随仓库分发的本地机器人图片，不再产生第三方图片请求', () => {
    const { container } = render(<RequirementPipeline collapsible tasks={tasks} />);
    fireEvent.click(screen.getByRole('button', { name: '展开团队视图' }));

    // 机器人图片保留，但必须来自同源 /robots/ 静态资源，而不是第三方 text_to_image 接口。
    expect(container.querySelectorAll('img[src^="/robots/"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(container.querySelectorAll('img[src*="trae-api"]')).toHaveLength(0);
    expect(container.querySelectorAll('.wm-role-avatar').length).toBeGreaterThan(0);
    // 角色卡徽标保留可访问名称；任务卡徽标与文字重复，标记为装饰性。
    expect(screen.getAllByRole('img', { name: '研发' }).length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('.pipeline-task-card-owner .wm-role-avatar[aria-hidden="true"]')
        .length,
    ).toBeGreaterThan(0);
  });

  it('首屏摘要显示当前阶段、真实负责人和阻塞原因，并只提供真实动作入口', () => {
    const onAction = vi.fn();
    render(
      <RequirementPipeline
        collapsible
        phases={[
          {
            id: 'build',
            label: '开发实现',
            role: 'engineering',
            roleLabel: '研发',
            status: 'blocked',
            ownerLabel: 'owner@example.com',
            blockedReason: '等待接口契约确认',
            actionLabel: '查看阻塞任务',
            onAction,
          },
        ]}
      />,
    );

    expect(screen.getByText('开发实现')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('等待接口契约确认')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看阻塞任务' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('缺少负责人或阻塞原因时明确标注未知，并给阶段轨道可访问当前态', () => {
    render(
      <RequirementPipeline
        collapsible
        phases={[{ id: 'build', label: '开发实现', role: 'engineering', status: 'blocked' }]}
      />,
    );

    expect(screen.getByText('暂未分配责任人')).toBeInTheDocument();
    expect(screen.getByText('服务端未提供阻塞原因')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开团队视图' }));
    const rail = screen.getByRole('region', { name: '阶段进度，可横向滚动' });
    expect(rail).toHaveAttribute('tabindex', '0');
    expect(rail.querySelector('[aria-current="step"]')).not.toBeNull();
  });

  it('没有真实操作入口时明确说明原因，并允许调用方透传更准确的说明', () => {
    const { rerender } = render(
      <RequirementPipeline
        collapsible
        phases={[{ id: 'build', label: '开发实现', role: 'engineering', status: 'active' }]}
        actionLabel={null}
        onAction={null}
      />,
    );

    expect(screen.getByText('当前没有可用操作入口；可展开团队视图查看任务。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '定位任务' })).not.toBeInTheDocument();

    rerender(
      <RequirementPipeline
        collapsible
        phases={[{ id: 'build', label: '开发实现', role: 'engineering', status: 'active' }]}
        actionLabel={null}
        onAction={null}
        actionUnavailableReason="服务端未提供可定位的任务入口，请刷新后重试。"
      />,
    );
    expect(screen.getByText('服务端未提供可定位的任务入口，请刷新后重试。')).toBeInTheDocument();
    expect(
      screen.queryByText('当前没有可用操作入口；可展开团队视图查看任务。'),
    ).not.toBeInTheDocument();
  });

  it('空的前置阶段不会遮住唯一真实任务阶段与负责人', () => {
    render(
      <RequirementPipeline
        collapsible
        phases={[
          { id: 'discovery', label: '需求发现', role: 'product', tasks: [] },
          {
            id: 'build',
            label: '开发实现',
            role: 'engineering',
            tasks: [
              {
                id: 'backend-impl',
                stepKey: 'backend-impl',
                role: 'backend',
                ownerLabel: 'fixture@example.test',
                executionStatus: 'OPEN',
                workStatus: 'ACTIVE',
                dependsOnStepKeys: [],
                doneStepKeys: [],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('开发实现')).toBeInTheDocument();
    expect(screen.getByText('fixture@example.test')).toBeInTheDocument();
    expect(screen.queryByText('暂未分配责任人')).not.toBeInTheDocument();
  });

  it('没有任务时不推断全部完成或无阻塞', () => {
    render(
      <RequirementPipeline
        collapsible
        phases={[{ id: 'discovery', label: '需求发现', role: 'product', tasks: [] }]}
      />,
    );
    expect(screen.getByRole('img', { name: '阶段进度：0/1 个阶段已完成' })).toBeInTheDocument();
    expect(screen.queryByText('全部任务已完成，无待处理阻塞')).not.toBeInTheDocument();
  });
});
