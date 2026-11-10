import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Requirements } from './Requirements';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import {
  bodyOf,
  envelope,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
  type StubReply,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 3 };
const requirement = {
  id: 'req-1',
  projectId: 'p1',
  seq: 1,
  code: 'DEMO-REQ-1',
  title: '结算流程',
  description: null,
  version: 2,
  generation: 1,
  phase: 'DISCOVERY',
  workStatus: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const roles = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
  { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
];
const members = [
  { id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'OWNER', version: 1 },
  { id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'MEMBER', version: 1 },
];
const publishedDefinition = {
  workflowKey: 'standard',
  title: '标准交付流程',
  version: 2,
  currentRevision: 1,
  currentPublishedRevisionId: 'rev-1',
};

function handler(input: {
  definitions?: unknown[];
  definition?: Record<string, unknown>;
  repositories?: unknown[];
  acceptanceKeys?: string[];
  requirements?: unknown[];
}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
      const params = new URL(url, 'http://localhost').searchParams;
      const q = params.get('q')?.toLowerCase() ?? '';
      const phase = params.get('phase');
      const cursor = Number(params.get('cursor') ?? 0);
      const limit = Number(params.get('limit') ?? 50);
      const matched = ((input.requirements ?? [requirement]) as Array<typeof requirement>).filter(
        (item) =>
          (!phase || item.phase === phase) &&
          (!q ||
            [item.code, item.title, item.description ?? ''].join(' ').toLowerCase().includes(q)),
      );
      const page = matched.filter((item) => item.seq > cursor).slice(0, limit);
      return {
        status: 200,
        body: envelope({
          items: page,
          nextCursor:
            matched.filter((item) => item.seq > cursor).length > limit
              ? String(page[page.length - 1]!.seq)
              : null,
          total: matched.length,
        }),
      };
    }
    if (path === '/api/v1/projects/p1/members' && method === 'GET')
      return { status: 200, body: envelope(members) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope(roles) };
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
      return { status: 200, body: envelope(input.repositories ?? []) };
    if (path === '/api/v1/projects/p1/requirements/req-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          requirement,
          acceptanceKeys: input.acceptanceKeys ?? [],
          tasks: [],
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: 0, artifacts: 0, reviews: 0, changes: 0 },
        }),
      };
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
      return { status: 200, body: envelope({ items: input.definitions ?? [], nextCursor: null }) };
    if (path === '/api/v1/workflow-definition-revisions/rev-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          id: 'rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'd'.repeat(64),
          definition: input.definition ?? {},
        }),
      };
    if (path === '/api/v1/requirements/req-1/workflow-instances' && method === 'POST')
      return { status: 201, body: envelope({ instanceId: 'inst-1', requirementVersion: 3 }) };
    return undefined;
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Requirements />
    </MemoryRouter>,
  );
}

describe('Requirements（流程实例只由管理员显式绑定）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('新建需求走弹窗：标题为空时禁用提交，填写后提交并关闭弹窗', async () => {
    const baseHandler = handler({ definitions: [publishedDefinition] });
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/requirements' && method === 'POST')
        return {
          status: 201,
          body: envelope({ ...requirement, id: 'req-2', code: 'DEMO-REQ-2', title: '新需求' }),
        };
      return baseHandler(url, init);
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '新建需求' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: '创建需求' });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('需求标题'), {
      target: { value: '新需求' },
    });
    fireEvent.change(within(dialog).getByLabelText('需求描述'), {
      target: { value: '描述内容' },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('需求已创建。')).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/requirements' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(call?.[1] ?? {})).toEqual({ title: '新需求', description: '描述内容' });
  });

  it('没有可访问项目时显示创建项目入口并导航到真实项目列表', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects' && methodOf(init) === 'GET')
        return { status: 200, body: envelope([]) };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/requirements']}>
        <Routes>
          <Route path="/requirements" element={<Requirements />} />
          <Route path="/projects" element={<div>项目列表页</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const create = await screen.findByRole('button', { name: '创建项目' });
    expect(create).toBeInTheDocument();
    expect(screen.getByText('还没有可访问的项目')).toBeInTheDocument();
    fireEvent.click(create);
    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
  });

  it('项目列表读取失败不会伪装成空项目', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects' && methodOf(init) === 'GET')
        return {
          status: 500,
          body: { error: { code: 'INTERNAL_ERROR', message: '项目列表读取失败' } },
        };
      return undefined;
    });
    renderPage();

    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    expect(screen.queryByText('还没有可访问的项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
  });

  it('普通成员看不到初始化入口，只提交需求意图', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    mockFetch(handler({ definitions: [publishedDefinition] }));

    renderPage();

    expect(await screen.findByText('DEMO-REQ-1')).toBeInTheDocument();
    expect(screen.getByText(/流程实例由项目管理员初始化/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    // 成员不能只看到「没有按钮」：要能看到等待管理员这一明确状态。
    expect(screen.getByText('等待管理员初始化')).toBeInTheDocument();
    expect(screen.getByText('等待管理员初始化')).toHaveAttribute(
      'title',
      expect.stringContaining('Alice'),
    );
  });

  it('流程定义未发布时，管理员看到明确禁用状态而不是可点的初始化按钮', async () => {
    mockFetch(handler({ definitions: [] }));

    renderPage();

    expect(await screen.findByText('DEMO-REQ-1')).toBeInTheDocument();
    expect(screen.getByText('当前项目还没有已发布的流程定义。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '流程定义未发布' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('管理员逐项选择责任人与审批人后创建实例', async () => {
    const mock = mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', deps: [] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText(/流程实例已创建/)).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body.definitionRevisionId).toBe('rev-1');
    expect(body.expectedRequirementVersion).toBe(2);
    expect(body.stepBindings).toEqual([
      {
        stepKey: 'impl',
        roleId: 'r-frontend',
        responsibleUserId: 'u-2',
        repositoryIds: [],
        acceptanceKeys: [],
      },
    ]);
    expect(body.roleSlotBindings).toEqual([
      { slotKey: 'release-acceptance', roleId: 'r-product', userId: 'u-1' },
    ]);
  });

  it('同角色审批人与责任人相同时阻断提交', async () => {
    mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'prd', roleKey: 'product', deps: [] }],
          roleSlots: [{ key: 'product-approval', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 prd 责任人'), {
      target: { value: 'u-1' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 product-approval 审批人'), {
      target: { value: 'u-1' },
    });

    expect(await screen.findByText(/不能自审/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('IMPL 步骤没有代码仓库时阻断提交，并提示先登记仓库', async () => {
    mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', outputKinds: ['IMPL'] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });

    expect(await screen.findByText(/还没有登记代码仓库/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('单仓库项目自动带上仓库，验收条目默认归到验证步骤', async () => {
    const mock = mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', outputKinds: ['IMPL'] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
        repositories: [
          {
            id: 'repo-1',
            adapter: 'github',
            externalId: 'yesgoo/yifanfan',
            owner: 'yesgoo',
            name: 'yifanfan',
            defaultBranch: 'main',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        acceptanceKeys: ['A1'],
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText(/流程实例已创建/)).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body.stepBindings).toEqual([
      {
        stepKey: 'impl',
        roleId: 'r-frontend',
        responsibleUserId: 'u-2',
        repositoryIds: ['repo-1'],
        acceptanceKeys: ['A1'],
      },
    ]);
  });

  it('服务端分页只提供一套上一页/下一页，每页 12 条并展示全范围总数', async () => {
    const page1 = Array.from({ length: 12 }, (_, index) => ({
      ...requirement,
      id: `req-a${index}`,
      code: `DEMO-A${index}`,
      title: `一页需求 ${index}`,
    }));
    const page2 = [{ ...requirement, id: 'req-b1', code: 'DEMO-B1', title: '第二页需求 B1' }];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        return {
          status: 200,
          body: envelope({
            items: cursor ? page2 : page1,
            nextCursor: cursor ? null : 'cursor-page-2',
            total: 13,
          }),
        };
      }
      if (path === '/api/v1/projects/p1/members' && method === 'GET')
        return { status: 200, body: envelope(members) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return { status: 200, body: envelope(roles) };
      if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });

    renderPage();
    expect(await screen.findByText('一页需求 0')).toBeInTheDocument();
    expect(screen.queryByText('第二页需求 B1')).not.toBeInTheDocument();

    expect(screen.getByText('12 / 13')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByText('第二页需求 B1')).toBeInTheDocument();
    expect(screen.queryByText('一页需求 0')).not.toBeInTheDocument();
    expect(screen.getByText('第 2 / 2 页 · 共 13 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByText('一页需求 0')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 页 · 共 13 条')).toBeInTheDocument();
  });

  it('搜索未加载到第 70 条的需求时查询服务端，阶段选项不受当前页限制', async () => {
    const baseHandler = handler({ definitions: [] });
    const outsideFirstPage = {
      ...requirement,
      id: 'req-70',
      seq: 70,
      code: 'DEMO-070',
      title: '远端验收需求',
      phase: 'ACCEPTANCE',
    };
    const mock = mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/requirements' && methodOf(init) === 'GET') {
        const params = new URL(url, 'http://localhost').searchParams;
        const matched = params.get('q') === '远端' && params.get('phase') === 'ACCEPTANCE';
        return {
          status: 200,
          body: envelope({
            items: matched ? [outsideFirstPage] : [requirement],
            nextCursor: matched ? null : 'unloaded-page',
            total: matched ? 1 : 70,
          }),
        };
      }
      return baseHandler(url, init);
    });
    renderPage();
    expect(await screen.findByText(requirement.title)).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('阶段筛选')).getByRole('option', { name: '验收' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('阶段筛选'), { target: { value: 'ACCEPTANCE' } });
    fireEvent.change(screen.getByLabelText('搜索需求'), { target: { value: '远端' } });
    expect(await screen.findByText('远端验收需求')).toBeInTheDocument();
    expect(screen.queryByText(requirement.title)).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(([url]) => {
        const parsed = new URL(String(url), 'http://localhost');
        return (
          parsed.searchParams.get('q') === '远端' &&
          parsed.searchParams.get('phase') === 'ACCEPTANCE' &&
          parsed.searchParams.get('limit') === '12' &&
          !parsed.searchParams.has('cursor')
        );
      }),
    ).toBe(true);
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('改变筛选后回到第一页，迟到的旧分页响应不能覆盖新结果', async () => {
    const baseHandler = handler({ definitions: [] });
    let release: (reply: StubReply) => void = () => {};
    const pending = new Promise<StubReply>((resolve) => {
      release = resolve;
    });
    const mock = mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/requirements' && methodOf(init) === 'GET') {
        const params = new URL(url, 'http://localhost').searchParams;
        if (params.get('cursor')) return pending;
        if (params.get('phase') === 'DELIVERY') {
          return {
            status: 200,
            body: envelope({
              items: [{ ...requirement, title: '筛选后交付需求', phase: 'DELIVERY' }],
              nextCursor: null,
              total: 1,
            }),
          };
        }
        return {
          status: 200,
          body: envelope({ items: [requirement], nextCursor: 'page-2', total: 20 }),
        };
      }
      return baseHandler(url, init);
    });
    renderPage();
    expect(await screen.findByText(requirement.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          ([url]) =>
            new URL(String(url), 'http://localhost').searchParams.get('cursor') === 'page-2',
        ),
      ).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('阶段筛选'), { target: { value: 'DELIVERY' } });
    expect(await screen.findByText('筛选后交付需求')).toBeInTheDocument();
    await act(async () => {
      release({
        status: 200,
        body: envelope({
          items: [{ ...requirement, title: '迟到的第二页' }],
          nextCursor: null,
          total: 20,
        }),
      });
    });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByText('迟到的第二页')).not.toBeInTheDocument();
    expect(screen.getByText('筛选后交付需求')).toBeInTheDocument();
    expect(
      mock.mock.calls.some(([url]) => {
        const params = new URL(String(url), 'http://localhost').searchParams;
        return params.get('phase') === 'DELIVERY' && !params.has('cursor');
      }),
    ).toBe(true);
  });
});

/** 模拟窄屏 matchMedia：真实浏览器里由 CSS 断点切换，jsdom 里需要手动注入。 */
function stubNarrowViewport(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const manyRequirements = Array.from({ length: 13 }, (_, index) => ({
  ...requirement,
  id: `req-${index + 1}`,
  seq: index + 1,
  code: `DEMO-REQ-${index + 1}`,
  title: `需求 ${index + 1}`,
}));

describe('Requirements（≤720px 卡片列表）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('窄屏渲染卡片列表、不渲染表格；搜索/阶段筛选/分页/详情入口仍可用', async () => {
    stubNarrowViewport(true);
    mockFetch(handler({ definitions: [publishedDefinition], requirements: manyRequirements }));

    renderPage();

    expect(await screen.findByTestId('requirements-card-list')).toBeInTheDocument();
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();

    const cards = screen.getAllByTestId('requirement-card');
    expect(cards).toHaveLength(12); // 每页 12 条与桌面一致
    const firstCard = cards[0]!;
    expect(within(firstCard).getByText('DEMO-REQ-1')).toBeInTheDocument();
    expect(within(firstCard).getByText('需求 1')).toBeInTheDocument();
    // 阶段 / 执行状态 tag 与桌面表格同一口径
    expect(within(firstCard).getByText('需求发现')).toBeInTheDocument();
    expect(within(firstCard).getByText('进行中')).toBeInTheDocument();
    // 核心入口在卡片内可点，不再位于横向滚动区外
    expect(within(firstCard).getByRole('button', { name: '详情' })).toBeEnabled();
    expect(within(firstCard).getByRole('button', { name: '初始化流程' })).toBeEnabled();

    // 搜索在卡片模式下仍然生效
    fireEvent.change(screen.getByLabelText('搜索需求'), { target: { value: '需求 13' } });
    expect(await screen.findByText('需求 13')).toBeInTheDocument();
    expect(screen.getAllByTestId('requirement-card')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('搜索需求'), { target: { value: '' } });
    expect(await screen.findByText('第 1 / 2 页 · 共 13 条')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByText('需求 13')).toBeInTheDocument();
    expect(screen.getAllByTestId('requirement-card')).toHaveLength(1);

    // 阶段筛选在卡片模式下仍然生效
    fireEvent.change(screen.getByLabelText('阶段筛选'), { target: { value: 'DISCOVERY' } });
    expect(await screen.findByText('第 1 / 2 页 · 共 13 条')).toBeInTheDocument();
  });

  it('桌面（无窄屏媒体查询）仍渲染 7 列表格，不渲染卡片列表', async () => {
    mockFetch(handler({ definitions: [publishedDefinition] }));

    renderPage();

    expect(await screen.findByTestId('requirements-table')).toBeInTheDocument();
    expect(screen.queryByTestId('requirements-card-list')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '编号' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '描述' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '详情' })).toBeEnabled();
  });
});

describe('Requirements（加载反馈）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('首次加载显示表格骨架与可读加载状态，不闪空态文案与 0 / 0 计数', async () => {
    let release: (reply: StubReply) => void = () => {};
    const pending = new Promise<StubReply>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') return pending;
      if (path === '/api/v1/projects/p1/members' && method === 'GET')
        return { status: 200, body: envelope(members) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return { status: 200, body: envelope(roles) };
      if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });

    renderPage();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/正在加载/);
    expect(document.querySelectorAll('.wm-skeleton-row').length).toBeGreaterThan(0);
    expect(screen.getByTestId('requirements-table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('还没有需求，点右上角「新建需求」创建。')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();

    release({ status: 200, body: envelope({ items: [requirement], nextCursor: null, total: 1 }) });

    expect(await screen.findByText('DEMO-REQ-1')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
