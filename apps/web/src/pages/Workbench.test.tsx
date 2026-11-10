import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbench } from './Workbench';
import { setCsrfToken } from '../api/client';
import {
  bodyOf,
  envelope,
  headersOf,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

const snapshot = {
  counts: { reviews: 1, changes: 1, readyTasks: 1, total: 3 },
  reviews: [
    {
      reviewId: 'review-1',
      kind: 'PRD_PUBLICATION',
      status: 'OPEN',
      version: 3,
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-1', title: '登录页改版' },
      subjectLabel: 'PRD v3',
      role: { id: 'role-product', key: 'product', title: '产品' },
      slots: [
        {
          id: 'slot-1',
          slotKey: 'product',
          requiredUserId: 'user-1',
          requiredRoleId: 'role-product',
          decided: false,
          viewerCanDecide: true,
        },
      ],
      ageSeconds: 259200,
      evidence: { artifactCount: 2, hasPr: true },
    },
  ],
  changes: [
    {
      recipientId: 'c1',
      eventId: 'evt-1',
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-2', title: '订单取消规则' },
      changedFields: ['acceptance'],
      targets: {},
      pendingRoles: [{ key: 'backend', title: '后端' }],
      version: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      ageSeconds: 172800,
    },
  ],
  readyTasks: [
    {
      taskId: 'task-1',
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-3', title: '支付回调重试' },
      role: { key: 'backend', title: '后端' },
      stepKey: 'backend-impl',
      stepDisplayName: '回调实现',
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      ageSeconds: null,
      responsibleUser: { id: 'user-1', email: 'developer@example.test' },
      claimEligibility: { canClaim: true, reason: null },
    },
  ],
  warnings: [],
};

function makeChange(recipientId: string, code: string, title: string, version = 2) {
  return {
    recipientId,
    eventId: `evt-${recipientId}`,
    projectId: 'p1',
    projectKey: 'DEMO',
    projectName: 'Demo',
    requirement: { code, title },
    changedFields: ['acceptance'],
    targets: {},
    pendingRoles: [{ key: 'backend', title: '后端' }],
    version,
    createdAt: '2026-11-01T00:00:00.000Z',
    ageSeconds: 100,
  };
}

const multiChangeSnapshot = {
  counts: { reviews: 0, changes: 3, readyTasks: 0, total: 3 },
  reviews: [],
  changes: [
    makeChange('c1', 'DEMO-REQ-1', '登录页改版'),
    makeChange('c2', 'DEMO-REQ-2', '订单取消规则'),
    makeChange('c3', 'DEMO-REQ-3', '支付回调重试'),
  ],
  readyTasks: [],
  warnings: [],
};

const emptySnapshot = {
  counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
  reviews: [],
  changes: [],
  readyTasks: [],
  warnings: [],
};

interface StubReply {
  status: number;
  body: unknown;
}

const ACK_OK: StubReply = { status: 200, body: envelope({ acked: true }) };
const SERVER_ERROR: StubReply = {
  status: 500,
  body: {
    error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'req-500' },
  },
};
const VERSION_CONFLICT: StubReply = {
  status: 409,
  body: {
    error: {
      code: 'VERSION_CONFLICT',
      message: '收件人版本已变化',
      details: { currentVersion: 3 },
      requestId: 'req-409',
    },
  },
};

interface HandlerOptions {
  /** 按第 N 次 workbench GET（从 1 开始）返回响应。 */
  workbench?: (call: number) => StubReply;
  /** 按收件人 + 第 N 次 ack（从 1 开始）返回响应。 */
  ack?: (recipientId: string, call: number) => StubReply;
}

function makeHandler(options: HandlerOptions = {}) {
  const ackCalls = new Map<string, number>();
  let workbenchCall = 0;
  const handler = (url: string, init: RequestInit): StubReply | undefined => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/activity' && method === 'GET')
      return { status: 200, body: envelope({ items: [] }) };
    if (path === '/api/v1/workbench' && method === 'GET') {
      workbenchCall += 1;
      return options.workbench?.(workbenchCall) ?? { status: 200, body: envelope(snapshot) };
    }
    const ackPath = /^\/api\/v1\/change-recipients\/([^/]+)\/ack$/.exec(path);
    if (ackPath && method === 'POST') {
      const recipientId = decodeURIComponent(ackPath[1] ?? '');
      const call = (ackCalls.get(recipientId) ?? 0) + 1;
      ackCalls.set(recipientId, call);
      return options.ack?.(recipientId, call) ?? ACK_OK;
    }
    return undefined;
  };
  return { handler, ackCalls };
}

function setup(options: HandlerOptions = {}) {
  const recorder = makeHandler(options);
  const fetchMock = mockFetch(recorder.handler);
  return { ...recorder, fetchMock };
}

function handler(overrides: { ackStatus?: number } = {}) {
  return makeHandler({
    ack: () => (overrides.ackStatus === 409 ? VERSION_CONFLICT : ACK_OK),
  }).handler;
}

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <Workbench />
    </MemoryRouter>,
  );
}

function CurrentUrl() {
  const location = useLocation();
  return (
    <output aria-label="地址">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe('工作台优先行动与范围隔离', () => {
  beforeEach(() => {
    useProject('p1');
  });
  it('指定给本人时显示负责人、领取资格和真实任务命令入口', async () => {
    setup();
    renderWorkbench();
    expect(await screen.findByText(/当前负责人：developer@example.test/)).toHaveTextContent(
      '本人可领取',
    );
    expect(screen.getByRole('button', { name: '复制领取命令' })).toBeEnabled();
    expect(screen.getByText(/必需输入会在获取上下文时检查/)).toBeInTheDocument();
  });
  it('同角色同事的任务只供查看，不能复制领取命令', async () => {
    setup({
      workbench: () => ({
        status: 200,
        body: envelope({
          ...snapshot,
          readyTasks: [
            {
              ...snapshot.readyTasks[0],
              responsibleUser: { id: 'teammate', email: 'teammate@example.test' },
              claimEligibility: { canClaim: false, reason: 'NOT_RESPONSIBLE' },
            },
          ],
        }),
      }),
    });
    renderWorkbench();
    expect(await screen.findByText(/当前负责人：teammate@example.test/)).toHaveTextContent(
      '本人不可领取',
    );
    expect(screen.getByText(/等待指定负责人领取/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制领取命令' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看上下文' })).toBeEnabled();
  });
  it('旧快照没有领取资格时不默认允许复制命令', async () => {
    const { claimEligibility: _eligibility, ...legacyTask } = snapshot.readyTasks[0];
    setup({
      workbench: () => ({
        status: 200,
        body: envelope({ ...snapshot, readyTasks: [legacyTask] }),
      }),
    });
    renderWorkbench();
    await screen.findByText(/领取资格尚未确认，请刷新后查看/);
    expect(screen.getByRole('button', { name: '复制领取命令' })).toBeDisabled();
  });
  it('显示全部项目范围与真实等待时间，行动入口直达评审', async () => {
    setup();
    render(
      <MemoryRouter>
        <CurrentUrl />
        <Workbench />
      </MemoryRouter>,
    );
    const actions = await screen.findByRole('region', { name: '优先行动' });
    await within(actions).findByText('待审批 · 1');
    expect(screen.getByText(/回调实现/)).toBeInTheDocument();
    expect(screen.getByText('范围：全部项目')).toBeInTheDocument();
    expect(within(actions).getByText('最早已等待 3 天')).toBeInTheDocument();
    expect(within(actions).getAllByText('服务端未提供等待时间').length).toBeGreaterThan(0);
    fireEvent.click(within(actions).getByRole('button', { name: '打开待审批' }));
    expect(screen.getByLabelText('地址')).toHaveTextContent('/reviews/review-1');
  });
  it('筛选同时更新行动统计，空类别禁用入口；失败不伪装为零件待办', async () => {
    setup({
      workbench: (call) => (call === 2 ? SERVER_ERROR : { status: 200, body: envelope(snapshot) }),
    });
    renderWorkbench();
    await screen.findByText(/登录页改版/);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索待办' }), {
      target: { value: '支付回调' },
    });
    const actions = screen.getByRole('region', { name: '优先行动' });
    expect(within(actions).getByText('待审批 · 0')).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: '打开待审批' })).toBeDisabled();
    expect(within(actions).getByText('前置任务已完成 · 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(
      await within(actions).findByText('行动项可能已过期，请刷新后确认。'),
    ).toBeInTheDocument();
    expect(within(actions).getByText('前置任务已完成 · 1')).toBeInTheDocument();
  });
  it('切换范围同步URL，旧慢响应不能覆盖新项目，清除旧搜索和选中项', async () => {
    let resolveOld!: (reply: { status: number; body: unknown }) => void;
    const old = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveOld = resolve;
    });
    mockFetch((url) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects')
        return {
          status: 200,
          body: envelope([project, { ...project, id: 'p2', key: 'TWO', name: '项目二' }]),
        };
      if (path === '/api/v1/activity') return { status: 200, body: envelope({ items: [] }) };
      if (path === '/api/v1/workbench')
        return url.includes('projectId=p1') ? old : { status: 200, body: envelope(emptySnapshot) };
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/?projectId=p1']}>
        <CurrentUrl />
        <Workbench />
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: '项目二（TWO）' });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索待办' }), {
      target: { value: '旧筛选' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '项目范围' }), {
      target: { value: 'p2' },
    });
    await screen.findByText('现在没有待办');
    expect(screen.getByLabelText('地址')).toHaveTextContent('projectId=p2');
    expect(screen.getByRole('textbox', { name: '搜索待办' })).toHaveValue('');
    await act(async () => {
      resolveOld({ status: 200, body: envelope(snapshot) });
    });
    expect(screen.queryByText(/登录页改版/)).not.toBeInTheDocument();
    expect(screen.getByText('范围：项目二')).toBeInTheDocument();
  });
  it('新范围失败时旧范围成功不能恢复旧列表', async () => {
    let resolveOld!: (reply: { status: number; body: unknown }) => void;
    const old = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveOld = resolve;
    });
    mockFetch((url) => {
      if (pathOf(url) === '/api/v1/projects') return { status: 200, body: envelope([project]) };
      if (pathOf(url) === '/api/v1/workbench')
        return url.includes('projectId=p1') ? old : SERVER_ERROR;
      if (pathOf(url) === '/api/v1/activity') return { status: 200, body: envelope({ items: [] }) };
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/?projectId=p1']}>
        <Workbench />
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: 'Demo（DEMO）' });
    fireEvent.change(screen.getByRole('combobox', { name: '项目范围' }), { target: { value: '' } });
    await screen.findByText('工作台加载失败');
    await act(async () => {
      resolveOld({ status: 200, body: envelope(snapshot) });
    });
    expect(screen.getByText('工作台加载失败')).toBeInTheDocument();
    expect(screen.queryByText(/登录页改版/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '优先行动' })).toHaveTextContent('无法读取行动项');
  });
});

describe('Workbench（跨项目待办聚合）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('展示四类待办与人类可读标识，不出现裸 UUID', async () => {
    mockFetch(handler());
    renderWorkbench();

    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    expect(screen.getByText(/订单取消规则/)).toBeInTheDocument();
    expect(screen.getByText(/支付回调重试/)).toBeInTheDocument();
    expect(screen.getByText(/DEMO-REQ-1/)).toBeInTheDocument();
    expect(screen.getByText(/证据 2 件 · 含 PR/)).toBeInTheDocument();
    expect(screen.queryByText('review-1')).not.toBeInTheDocument();
    expect(screen.queryByText('evt-1')).not.toBeInTheDocument();
    expect(screen.getByText('待处理事项')).toBeInTheDocument();
    expect(screen.getByText('Agent 操作提示')).toBeInTheDocument();
    expect(screen.queryByText(/SYS\.STATE/)).not.toBeInTheDocument();
  });

  it('逾期审批置顶展示，按到期时间排序并带评审入口', async () => {
    const overdueSnapshot = {
      ...snapshot,
      counts: { ...snapshot.counts, overdueApprovals: 1 },
      overdueApprovals: [
        {
          slotId: 'slot-late',
          slotKey: 'task-acceptance',
          kind: 'TASK_ACCEPTANCE',
          reviewId: 'review-9',
          projectId: 'p1',
          projectKey: 'DEMO',
          projectName: 'Demo',
          dueAt: '2026-11-01T00:00:00.000Z',
          escalated: false,
          overdueSeconds: 7200,
        },
      ],
    };
    setup({ workbench: () => ({ status: 200, body: envelope(overdueSnapshot) }) });
    renderWorkbench();

    const section = await screen.findByRole('region', { name: '逾期审批' });
    expect(within(section).getByText('逾期审批 1 条')).toBeInTheDocument();
    expect(within(section).getByText('Demo')).toBeInTheDocument();
    expect(within(section).getByText(/逾期 2 小时/)).toBeInTheDocument();
    expect(within(section).getByRole('button')).toHaveTextContent(/任务验收|task-acceptance/);
  });

  it('记住角色筛选，下次打开继续生效', async () => {
    mockFetch(handler());
    renderWorkbench();

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const select = await screen.findByLabelText('角色筛选');
      await screen.findByRole('option', { name: '后端' });
      fireEvent.change(select, { target: { value: 'backend' } });

      expect(setItem).toHaveBeenCalledWith('workmesh.workbench.role', 'backend');
    } finally {
      setItem.mockRestore();
    }
  });

  it('确认变更提交收件人版本；旧版本 409 原样展示', async () => {
    const mock = mockFetch(handler({ ackStatus: 409 }));
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: '去确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认已知悉' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 收件人版本已变化 · requestId req-409',
    );
    expect(screen.queryByText('变更已确认。')).not.toBeInTheDocument();

    const ackCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/change-recipients/c1/ack' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(ackCall?.[1] ?? {})).toEqual({ expectedVersion: 2 });
    expect(headersOf(ackCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });

  it('确认成功时提示并刷新', async () => {
    mockFetch(handler());
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: '去确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认已知悉' }));

    expect(await screen.findByText('变更已确认。')).toBeInTheDocument();
  });

  it('刷新成功后展示统一的 HH:mm 更新时间与“已同步”数据状态', async () => {
    setup();
    renderWorkbench();

    const updated = await screen.findByText(/^更新于 \d{2}:\d{2}$/);
    const railStatus = screen.getByText(/^已同步 · \d{2}:\d{2}$/);
    const clock = (railStatus.textContent ?? '').replace('已同步 · ', '');

    // 工具栏“更新于”、rail 主状态、更新时间元数据使用同一 HH:mm 来源。
    expect(updated).toHaveTextContent(`更新于 ${clock}`);
    expect(screen.getByText('更新时间').nextElementSibling).toHaveTextContent(clock);
  });

  it('已有数据时刷新失败进入 stale：保留旧数据、给出上次成功时间并可重试', async () => {
    const recorder = setup({
      workbench: (call) => (call === 2 ? SERVER_ERROR : { status: 200, body: envelope(snapshot) }),
    });
    renderWorkbench();

    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText(/当前显示的是上次成功数据 · \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/^显示上次成功数据 · \d{2}:\d{2}$/)).toBeInTheDocument();
    // 刷新失败不得清空旧数据，也不得伪装成页面级错误。
    expect(screen.getByText(/登录页改版/)).toBeInTheDocument();
    expect(screen.queryByText('工作台加载失败')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试更新工作台数据' }));
    await waitFor(() =>
      expect(screen.queryByText(/当前显示的是上次成功数据/)).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/^已同步 · \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(recorder.ackCalls.size).toBe(0);
  });

  it('首次加载失败显示页面级错误与重试，恢复后展示数据', async () => {
    setup({
      workbench: (call) => (call === 1 ? SERVER_ERROR : { status: 200, body: envelope(snapshot) }),
    });
    renderWorkbench();

    expect(await screen.findByText('工作台加载失败')).toBeInTheDocument();
    expect(screen.getByText('暂时无法读取工作台数据。')).toBeInTheDocument();
    expect(
      screen.getByText(/\[INTERNAL_ERROR\] 服务暂时不可用 · requestId req-500/),
    ).toBeInTheDocument();
    // 失败不能显示成“没有待办”。
    expect(screen.queryByText('现在没有待办')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载工作台数据' }));
    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    expect(screen.queryByText('工作台加载失败')).not.toBeInTheDocument();
  });

  it('首次加载中只显示骨架屏，不显示空态', async () => {
    setup();
    renderWorkbench();

    expect(document.querySelectorAll('.skeleton-row')).toHaveLength(3);
    expect(screen.queryByText('现在没有待办')).not.toBeInTheDocument();
    expect(screen.queryByText('当前筛选没有匹配项')).not.toBeInTheDocument();

    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton-row')).toHaveLength(0);
  });

  it('筛选没有匹配项时给出清除入口，清除后恢复列表', async () => {
    setup();
    renderWorkbench();

    await screen.findByText(/登录页改版/);
    fireEvent.change(screen.getByLabelText('搜索待办'), {
      target: { value: '不存在的关键词' },
    });

    expect(await screen.findByText('当前筛选没有匹配项')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));

    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    expect(screen.queryByText('当前筛选没有匹配项')).not.toBeInTheDocument();
  });

  it('无筛选且确实没有待办时显示真实空态并说明当前范围', async () => {
    setup({ workbench: () => ({ status: 200, body: envelope(emptySnapshot) }) });
    renderWorkbench();

    expect(await screen.findByText('现在没有待办')).toBeInTheDocument();
    expect(screen.getByText(/当前范围：全部项目/)).toBeInTheDocument();
    expect(screen.queryByText('当前筛选没有匹配项')).not.toBeInTheDocument();
  });

  it('筛选条件变化会清除已选变更并提示', async () => {
    setup({ workbench: () => ({ status: 200, body: envelope(multiChangeSnapshot) }) });
    renderWorkbench();

    fireEvent.click(await screen.findByRole('tab', { name: /待确认变更/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ }));
    expect(await screen.findByRole('button', { name: '批量确认 1 条' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索待办'), { target: { value: '登录' } });

    expect(await screen.findByText('筛选已变化，已清除之前的选择。')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /批量确认/ })).not.toBeInTheDocument();
  });

  it('批量逐条确认：失败即停止，成功的条目不会被重复提交', async () => {
    const recorder = setup({
      workbench: () => ({ status: 200, body: envelope(multiChangeSnapshot) }),
      ack: (recipientId, call) => (recipientId === 'c2' && call === 1 ? SERVER_ERROR : ACK_OK),
    });
    renderWorkbench();

    fireEvent.click(await screen.findByRole('tab', { name: /待确认变更/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /选择变更 DEMO-REQ-2/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /选择变更 DEMO-REQ-3/ }));
    fireEvent.click(await screen.findByRole('button', { name: '批量确认 3 条' }));

    // 确认前列出所有将提交条目（需求编号 · 标题、版本）。
    const pending = await screen.findByRole('list', { name: '待提交变更列表' });
    expect(pending).toHaveTextContent('DEMO-REQ-2 · 订单取消规则 · v2');

    fireEvent.click(screen.getByRole('button', { name: '确认开始' }));

    expect(await screen.findByText(/已确认 1 条 · 失败 1 条 · 未处理 1 条/)).toBeInTheDocument();
    expect(recorder.ackCalls.get('c1')).toBe(1);
    expect(recorder.ackCalls.get('c2')).toBe(1);
    expect(recorder.ackCalls.get('c3')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '重试失败项（2）' }));

    expect(await screen.findByText(/已确认 3 条 · 失败 0 条 · 未处理 0 条/)).toBeInTheDocument();
    // 已成功项不重复提交，失败项与未处理项各重试一次。
    expect(recorder.ackCalls.get('c1')).toBe(1);
    expect(recorder.ackCalls.get('c2')).toBe(2);
    expect(recorder.ackCalls.get('c3')).toBe(1);

    const list = screen.getByRole('list', { name: '批量确认结果' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByText(/DEMO-REQ-1/)).toHaveLength(1);
  });

  it('批量结果按已确认/失败/未处理计数并保留失败原因', async () => {
    const recorder = setup({
      workbench: () => ({ status: 200, body: envelope(multiChangeSnapshot) }),
      ack: () => SERVER_ERROR,
    });
    renderWorkbench();

    fireEvent.click(await screen.findByRole('tab', { name: /待确认变更/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /选择变更 DEMO-REQ-2/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /选择变更 DEMO-REQ-3/ }));
    fireEvent.click(await screen.findByRole('button', { name: '批量确认 3 条' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认开始' }));

    expect(await screen.findByText(/已确认 0 条 · 失败 1 条 · 未处理 2 条/)).toBeInTheDocument();
    expect(screen.getByText(/\[INTERNAL_ERROR\] 服务暂时不可用/)).toBeInTheDocument();
    expect(recorder.ackCalls.get('c1')).toBe(1);
    expect(recorder.ackCalls.get('c2')).toBeUndefined();
    expect(recorder.ackCalls.get('c3')).toBeUndefined();
  });

  it('批量确认遇到 409 时提示数据已变化，并允许重试', async () => {
    const recorder = setup({
      workbench: () => ({ status: 200, body: envelope(multiChangeSnapshot) }),
      ack: (recipientId, call) => (recipientId === 'c1' && call === 1 ? VERSION_CONFLICT : ACK_OK),
    });
    renderWorkbench();

    fireEvent.click(await screen.findByRole('tab', { name: /待确认变更/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-2/ }));
    fireEvent.click(await screen.findByRole('button', { name: '批量确认 2 条' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认开始' }));

    expect(await screen.findByText(/数据已变化，请重新加载/)).toBeInTheDocument();
    expect(screen.getByText(/\[VERSION_CONFLICT\] 收件人版本已变化/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试失败项（2）' }));
    expect(await screen.findByText(/已确认 2 条 · 失败 0 条 · 未处理 0 条/)).toBeInTheDocument();
    expect(recorder.ackCalls.get('c1')).toBe(2);
    expect(recorder.ackCalls.get('c2')).toBe(1);
  });

  it('批量完成后刷新失败：保留批量结果并显示 stale 状态', async () => {
    setup({
      workbench: (call) =>
        call === 1 ? { status: 200, body: envelope(multiChangeSnapshot) } : SERVER_ERROR,
      ack: () => ACK_OK,
    });
    renderWorkbench();

    fireEvent.click(await screen.findByRole('tab', { name: /待确认变更/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /选择变更 DEMO-REQ-1/ }));
    fireEvent.click(await screen.findByRole('button', { name: '批量确认 1 条' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认开始' }));

    expect(await screen.findByText(/已确认 1 条 · 失败 0 条 · 未处理 0 条/)).toBeInTheDocument();
    // 刷新失败：结果弹窗保留，同时提示数据已过期，旧列表不被清空。
    expect(await screen.findByText(/当前显示的是上次成功数据 · \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/批量确认已完成，但刷新工作台失败/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/已确认 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/订单取消规则/)).toBeInTheDocument();
  });

  it('勾选可决定的评审后出现批量批准入口，并打开批量弹窗', async () => {
    mockFetch(handler());
    renderWorkbench();

    const checkbox = await screen.findByRole('checkbox', { name: /选择批量批准/ });
    fireEvent.click(checkbox);

    const batchButton = await screen.findByRole('button', { name: '批量批准 1 条' });
    fireEvent.click(batchButton);

    const password = await screen.findByLabelText(/登录密码/);
    const dialog = await screen.findByRole('dialog', { name: '批量批准' });
    expect(dialog).toHaveTextContent(/将对 1 条评审提交「批准」/);
    expect(dialog).toContainElement(password);
  });

  it('待办页签支持方向键切换，并与 tabpanel 建立关联', async () => {
    mockFetch(handler());
    renderWorkbench();
    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();

    const allTab = screen.getByRole('tab', { name: /^全部/ });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(allTab).toHaveAttribute('aria-controls', 'wb-tabpanel');
    expect(allTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'wb-tab-all');
    expect(screen.getByRole('tab', { name: /待签字/ })).toHaveAttribute('tabindex', '-1');

    allTab.focus();
    fireEvent.keyDown(allTab, { key: 'ArrowRight' });
    const signOffTab = screen.getByRole('tab', { name: /待签字/ });
    await waitFor(() => expect(signOffTab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(signOffTab));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'wb-tab-signOffs');
  });
});
