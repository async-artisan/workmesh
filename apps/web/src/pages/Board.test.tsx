import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from './Board';
import { setCsrfToken } from '../api/client';
import type {
  BoardCard,
  BoardColumnKey,
  BoardRequirementGroup,
  BoardRequirementPage,
  BoardSnapshot,
} from '../api/resources';
import {
  envelope,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
  type StubHandler,
  type StubReply,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const project2 = { id: 'p2', key: 'TWO', name: 'Second', version: 1 };
const keys: BoardColumnKey[] = ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'];
function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    taskId: id,
    projectId: 'p1',
    stepKey: 'implement',
    stepDisplayName: '客户功能实现',
    roleId: 'role-backend',
    roleTitle: '后端',
    requirementCode: 'DEMO-1',
    requirementTitle: '登录功能',
    executionStatus: 'OPEN',
    workStatus: null,
    currentClaimId: null,
    currentArtifactSetId: null,
    claimedUserId: null,
    claimedAt: null,
    generation: 0,
    ...extra,
  };
}
function snapshot(
  cards = [card('task-open')],
  overrides: Partial<BoardSnapshot> = {},
): BoardSnapshot {
  return {
    projectId: 'p1',
    queryKey: 'query:all',
    summary: {
      total: 120,
      matchedTotal: 120,
      requirementTotal: 35,
      columns: keys.map((key) => ({
        key,
        total: key === 'BACKLOG' ? 119 : key === 'ACTIVE' ? 1 : 0,
      })),
    },
    columns: keys.map((key) => ({
      key,
      total: key === 'BACKLOG' ? 119 : key === 'ACTIVE' ? 1 : 0,
      cards: key === 'BACKLOG' ? cards : [],
      nextCursor: key === 'BACKLOG' ? 'backlog:next' : null,
    })),
    ...overrides,
  };
}
function group(code: string, extra: Partial<BoardRequirementGroup> = {}): BoardRequirementGroup {
  return {
    code,
    title: '服务端完整聚合',
    total: 75,
    counts: { BACKLOG: 40, ACTIVE: 20, BLOCKED: 10, PAUSED: 1, CANCELLED: 2, DELIVERED: 2 },
    roles: ['后端'],
    roleTotal: 12,
    rolesNextCursor: 'roles:' + code,
    ...extra,
  };
}
function requirements(
  items = [group('DEMO-19')],
  extra: Partial<BoardRequirementPage> = {},
): BoardRequirementPage {
  return {
    projectId: 'p1',
    queryKey: 'query:all',
    summary: snapshot().summary,
    items,
    nextCursor: 'groups:next',
    ...extra,
  };
}
function failed(message: string): StubReply {
  return { status: 503, body: { error: { code: 'TEMPORARY', message } } };
}
function success(value: unknown): StubReply {
  return { status: 200, body: envelope(value) };
}
function params(url: string) {
  return new URL(url, 'http://workmesh.test').searchParams;
}
function deferred() {
  let resolve!: (reply: StubReply) => void;
  const promise = new Promise<StubReply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(handler?: StubHandler, projects = [project]) {
  return mockFetch(async (url, init) => {
    const supplied = await handler?.(url, init);
    if (supplied) return supplied;
    if (pathOf(url) === '/api/v1/projects' && methodOf(init) === 'GET') return success(projects);
    const projectId = pathOf(url).split('/')[4] ?? 'p1';
    if (/\/board\/filters\/(roles|requirements)$/.test(pathOf(url))) {
      const roles = pathOf(url).endsWith('/roles');
      return success({
        projectId,
        queryKey: 'facet:all',
        total: 1,
        items: roles
          ? [{ value: '后端', label: '后端' }]
          : [{ value: 'DEMO-1', label: 'DEMO-1 · 登录功能' }],
        nextCursor: null,
      });
    }
    if (pathOf(url) === '/api/v1/projects/p1/board') return success(snapshot());
    if (pathOf(url) === '/api/v1/projects/p1/board/requirements') return success(requirements());
    return undefined;
  });
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <Routes>
        <Route path="/board" element={<Board />} />
        <Route path="/requirements/:code" element={<div>需求详情页</div>} />
        <Route path="/projects" element={<div>项目列表页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Board 服务端分页', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });
  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('无项目时提供创建项目导航', async () => {
    setup(undefined, []);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '创建项目' }));
    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
  });

  it('首屏用服务端完整总数和六列，保持只读状态与需求导航', async () => {
    const fetch = setup();
    mount();
    expect(await screen.findByText(/显示 120 \/ 120/)).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: '未开始 119' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('客户功能实现')).toBeInTheDocument();
    expect(screen.getAllByText('状态待确认').length).toBeGreaterThan(0);
    expect(screen.queryByText('待认领')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.find(([url]) => pathOf(String(url)).endsWith('/board'))?.[0]).toContain(
      'limit=20',
    );
    fireEvent.click(screen.getByRole('tab', { name: '进行中 1' }));
    expect(document.querySelector('.board-col.is-mobile-active')).toHaveAttribute(
      'aria-label',
      '进行中列',
    );
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' });
    expect(await screen.findByText('需求详情页')).toBeInTheDocument();
  });

  it('首屏骨架不冒充空看板；刷新失败保留已有卡片，成功刷新重置续页', async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    setup((url) => {
      if (pathOf(url).endsWith('/board')) {
        const next = deferred();
        pending.push(next);
        return next.promise;
      }
    });
    mount();
    expect(await screen.findByTestId('board-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('该项目还没有任务。')).not.toBeInTheDocument();
    await act(async () => pending[0]!.resolve(success(snapshot())));
    expect(await screen.findByText('客户功能实现')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByText('客户功能实现')).toBeInTheDocument();
    expect(await screen.findByText('正在刷新看板…')).toBeInTheDocument();
    await act(async () => pending[1]!.resolve(failed('刷新暂时失败')));
    expect(await screen.findByRole('alert')).toHaveTextContent('刷新暂时失败');
    expect(screen.getByText('客户功能实现')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await act(async () =>
      pending[2]!.resolve(success(snapshot([card('fresh', { stepDisplayName: '刷新后内容' })]))),
    );
    expect(await screen.findByText('刷新后内容')).toBeInTheDocument();
    expect(screen.queryByText('客户功能实现')).not.toBeInTheDocument();
  });

  it('列续页准确携带范围，失败可重试并保留旧卡，重复记录不重复追加', async () => {
    let attempts = 0;
    const fetch = setup((url) => {
      if (pathOf(url).endsWith('/board/columns/BACKLOG')) {
        attempts += 1;
        return attempts === 1
          ? failed('分页暂时失败')
          : success({
              projectId: 'p1',
              queryKey: 'query:all',
              key: 'BACKLOG',
              total: 120,
              cards: [card('task-open'), card('task-next', { stepDisplayName: '第二页任务' })],
              nextCursor: null,
            });
      }
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多未开始任务' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('分页暂时失败');
    expect(screen.getByText('客户功能实现')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载更多未开始任务' }));
    expect(await screen.findByText('第二页任务')).toBeInTheDocument();
    expect(screen.getAllByText('客户功能实现')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '加载更多未开始任务' })).not.toBeInTheDocument();
    const request = fetch.mock.calls.find(([url]) =>
      pathOf(String(url)).endsWith('/columns/BACKLOG'),
    )!;
    expect(params(String(request[0])).get('cursor')).toBe('backlog:next');
    expect(params(String(request[0])).get('limit')).toBe('20');
  });

  it('筛选由服务端覆盖全量任务，不从首屏卡片本地过滤；旧筛选响应不覆盖新筛选', async () => {
    const old = deferred();
    const fetch = setup((url) => {
      if (!pathOf(url).endsWith('/board')) return;
      if (params(url).get('q') === 'old') return old.promise;
      if (params(url).get('q') === 'new')
        return success(
          snapshot(
            [card('new', { requirementCode: 'REMOTE-99', stepDisplayName: '全局搜索结果' })],
            { queryKey: 'query:new', summary: { ...snapshot().summary, matchedTotal: 37 } },
          ),
        );
    });
    mount();
    await screen.findByText('客户功能实现');
    fireEvent.change(screen.getByLabelText('搜索看板'), { target: { value: ' Old ' } });
    expect(screen.queryByText('客户功能实现')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索看板'), { target: { value: 'New' } });
    expect(await screen.findByText('全局搜索结果')).toBeInTheDocument();
    expect(screen.getByText(/显示 37 \/ 120/)).toBeInTheDocument();
    await act(async () =>
      old.resolve(success(snapshot([card('old', { stepDisplayName: '过期筛选' })]))),
    );
    expect(screen.queryByText('过期筛选')).not.toBeInTheDocument();
    const facetRequests = fetch.mock.calls.filter(([url]) => String(url).includes('/filters/'));
    for (const [url] of facetRequests) expect(params(String(url)).has('q')).toBe(false);
  });

  it('项目全局筛选选项可分页、可搜索；保留选择并发送准确角色/需求过滤', async () => {
    let roleMore = 0;
    const fetch = setup((url) => {
      if (pathOf(url).endsWith('/filters/roles')) {
        if (params(url).get('search') === 'QA')
          return success({
            projectId: 'p1',
            queryKey: 'facet:qa',
            total: 1,
            items: [{ value: 'QA 验收', label: 'QA 验收' }],
            nextCursor: null,
          });
        if (params(url).get('cursor')) {
          roleMore += 1;
          return roleMore === 1
            ? failed('角色页失败')
            : success({
                projectId: 'p1',
                queryKey: 'facet:all',
                total: 2,
                items: [{ value: '首屏外角色', label: '首屏外角色' }],
                nextCursor: null,
              });
        }
        return success({
          projectId: 'p1',
          queryKey: 'facet:all',
          total: 2,
          items: [{ value: '后端', label: '后端' }],
          nextCursor: 'facet:next',
        });
      }
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多角色选项' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试加载角色选项' }));
    await screen.findByRole('option', { name: '首屏外角色' });
    fireEvent.change(screen.getByLabelText('看板角色筛选'), { target: { value: '首屏外角色' } });
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url]) =>
            pathOf(String(url)).endsWith('/board') &&
            params(String(url)).get('roleTitle') === '首屏外角色',
        ),
      ).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('搜索角色选项'), { target: { value: 'QA' } });
    await screen.findByRole('option', { name: 'QA 验收' });
    expect(screen.getByLabelText('看板角色筛选')).toHaveValue('首屏外角色');
    fireEvent.change(screen.getByLabelText('看板需求筛选'), { target: { value: 'DEMO-1' } });
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url]) =>
            pathOf(String(url)).endsWith('/board') &&
            params(String(url)).get('requirementCode') === 'DEMO-1' &&
            params(String(url)).get('roleTitle') === '首屏外角色',
        ),
      ).toBe(true),
    );
    for (const [url] of fetch.mock.calls.filter(([url]) => String(url).includes('/filters/'))) {
      expect(params(String(url)).has('roleTitle')).toBe(false);
      expect(params(String(url)).has('requirementCode')).toBe(false);
    }
  });

  it('需求模式读取全量聚合和独立续页，显示取消数、完整角色可继续读取', async () => {
    let attempts = 0;
    const fetch = setup((url) => {
      if (pathOf(url).endsWith('/board/requirements') && params(url).get('cursor')) {
        attempts += 1;
        return attempts === 1
          ? failed('需求页失败')
          : success(
              requirements(
                [group('DEMO-19'), group('DEMO-33', { title: '后续需求', rolesNextCursor: null })],
                { nextCursor: null },
              ),
            );
      }
      if (
        pathOf(url).endsWith('/filters/roles') &&
        params(url).get('requirementCode') === 'DEMO-19'
      )
        return success({
          projectId: 'p1',
          queryKey: 'facet:requirement',
          total: 12,
          items: [{ value: '新角色', label: '新角色' }],
          nextCursor: null,
        });
    });
    mount();
    await screen.findByText('客户功能实现');
    fireEvent.change(screen.getByLabelText('看板角色筛选'), { target: { value: '后端' } });
    await screen.findByText('客户功能实现');
    fireEvent.change(screen.getByLabelText('搜索看板'), { target: { value: 'feature' } });
    await screen.findByText('客户功能实现');
    fireEvent.click(screen.getByRole('button', { name: '按需求' }));
    const row = await screen.findByRole('row', { name: /DEMO-19/ });
    expect(within(row).getByText('75')).toBeInTheDocument();
    expect(within(row).getByText('40')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '已取消' })).toBeInTheDocument();
    expect(screen.getByText('已加载 1 / 35 个匹配需求')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '加载更多DEMO-19角色' }));
    expect(await within(row).findByText(/后端 \/ 新角色/)).toBeInTheDocument();
    const roleRequest = fetch.mock.calls.find(
      ([url]) => params(String(url)).get('requirementCode') === 'DEMO-19',
    )!;
    expect(params(String(roleRequest[0])).get('q')).toBe('feature');
    expect(params(String(roleRequest[0])).get('roleTitle')).toBe('后端');
    expect(params(String(roleRequest[0])).get('limit')).toBe('10');
    expect(params(String(roleRequest[0])).get('cursor')).toBe('roles:DEMO-19');
    fireEvent.click(screen.getByRole('button', { name: '加载更多需求' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('需求页失败');
    expect(screen.getByText('DEMO-19 · 服务端完整聚合')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载更多需求' }));
    expect(await screen.findByText('DEMO-33 · 后续需求')).toBeInTheDocument();
    expect(screen.getAllByText('DEMO-19 · 服务端完整聚合')).toHaveLength(1);
  });

  it('切项目立即隐藏旧项目可点击卡片，旧列续页与旧项目响应不能污染新项目', async () => {
    const column = deferred();
    const nextProject = deferred();
    setup(
      (url) => {
        if (pathOf(url).endsWith('/columns/BACKLOG')) return column.promise;
        if (pathOf(url) === '/api/v1/projects/p2/board') return nextProject.promise;
      },
      [project, project2],
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多未开始任务' }));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await act(async () =>
      column.resolve(
        success({
          projectId: 'p1',
          queryKey: 'query:all',
          key: 'BACKLOG',
          total: 120,
          cards: [card('late', { stepDisplayName: '旧项目续页' })],
          nextCursor: null,
        }),
      ),
    );
    expect(screen.queryByText('旧项目续页')).not.toBeInTheDocument();
    await act(async () =>
      nextProject.resolve(
        success(
          snapshot([card('second', { projectId: 'p2', stepDisplayName: '第二个项目' })], {
            projectId: 'p2',
            queryKey: 'query:p2',
          }),
        ),
      ),
    );
    expect(await screen.findByText('第二个项目')).toBeInTheDocument();
    expect(screen.queryByText('客户功能实现')).not.toBeInTheDocument();
  });

  it('切换模式后旧聚合与角色页响应不会覆盖新列，卸载后的续页不影响新挂载', async () => {
    const page = deferred();
    const roles = deferred();
    const column = deferred();
    let columnRequests = 0;
    setup((url) => {
      if (pathOf(url).endsWith('/board/requirements') && params(url).get('cursor'))
        return page.promise;
      if (pathOf(url).endsWith('/filters/roles') && params(url).get('requirementCode'))
        return roles.promise;
      if (pathOf(url).endsWith('/columns/BACKLOG')) {
        columnRequests += 1;
        return column.promise;
      }
    });
    const view = mount();
    await screen.findByText('客户功能实现');
    fireEvent.click(screen.getByRole('button', { name: '按需求' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多需求' }));
    fireEvent.click(screen.getByRole('button', { name: '加载更多DEMO-19角色' }));
    fireEvent.click(screen.getByRole('button', { name: '按列' }));
    expect(await screen.findByText('客户功能实现')).toBeInTheDocument();
    await act(async () => {
      page.resolve(success(requirements([group('OLD-1')])));
      roles.resolve(
        success({
          projectId: 'p1',
          queryKey: 'old',
          total: 1,
          items: [{ value: '过期角色', label: '过期角色' }],
          nextCursor: null,
        }),
      );
    });
    expect(screen.queryByText(/OLD-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/过期角色/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多未开始任务' }));
    await waitFor(() => expect(columnRequests).toBe(1));
    view.unmount();
    mount();
    expect(await screen.findByText('客户功能实现')).toBeInTheDocument();
    await act(async () =>
      column.resolve(
        success({
          projectId: 'p1',
          queryKey: 'query:all',
          key: 'BACKLOG',
          total: 119,
          cards: [card('unmounted', { stepDisplayName: '卸载前的旧续页' })],
          nextCursor: null,
        }),
      ),
    );
    expect(screen.queryByText('卸载前的旧续页')).not.toBeInTheDocument();
    expect(screen.getByText('客户功能实现')).toBeInTheDocument();
  });

  it.each(['roles', 'requirements'] as const)(
    '显式刷新重新读取%s选项并淘汰旧游标，筛选和切模式不重读全项目选项',
    async (kind) => {
      const label = kind === 'roles' ? '角色' : '需求';
      const first = kind === 'roles' ? '后端' : 'DEMO-1';
      const second = kind === 'roles' ? '新角色' : 'DEMO-2';
      const third = kind === 'roles' ? '新续页角色' : 'DEMO-3';
      const stale = kind === 'roles' ? '过期角色选项' : 'OLD-REQ';
      const old = deferred();
      let firstPages = 0;
      const fetch = setup((url) => {
        if (!pathOf(url).endsWith('/filters/' + kind)) return;
        const cursor = params(url).get('cursor');
        if (cursor === 'old:' + kind) return old.promise;
        if (cursor === 'fresh:' + kind)
          return success({
            projectId: 'p1',
            queryKey: 'facet:refreshed',
            total: 3,
            items: [{ value: third, label: third }],
            nextCursor: null,
          });
        firstPages += 1;
        return success({
          projectId: 'p1',
          queryKey: firstPages === 1 ? 'facet:initial' : 'facet:refreshed',
          total: firstPages === 1 ? 1 : 3,
          items: (firstPages === 1 ? [first] : [first, second]).map((value) => ({
            value,
            label: value,
          })),
          nextCursor: (firstPages === 1 ? 'old:' : 'fresh:') + kind,
        });
      });
      mount();
      const select = screen.getByLabelText('看板' + label + '筛选');
      await within(select).findByRole('option', { name: first });
      fireEvent.change(select, { target: { value: first } });
      await screen.findByText('客户功能实现');
      fireEvent.click(screen.getByRole('button', { name: '加载更多' + label + '选项' }));
      await waitFor(() =>
        expect(
          fetch.mock.calls.some(([url]) => params(String(url)).get('cursor') === 'old:' + kind),
        ).toBe(true),
      );
      fireEvent.change(screen.getByLabelText('搜索看板'), { target: { value: 'feature' } });
      await screen.findByText('客户功能实现');
      fireEvent.click(screen.getByRole('button', { name: '按需求' }));
      await screen.findByText('DEMO-19 · 服务端完整聚合');
      expect(firstPages).toBe(1);
      fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      await within(select).findByRole('option', { name: second });
      expect(select).toHaveValue(first);
      expect(firstPages).toBe(2);
      await act(async () =>
        old.resolve(
          success({
            projectId: 'p1',
            queryKey: 'facet:initial',
            total: 2,
            items: [{ value: stale, label: stale }],
            nextCursor: 'stale:' + kind,
          }),
        ),
      );
      expect(within(select).queryByRole('option', { name: stale })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '加载更多' + label + '选项' }));
      await within(select).findByRole('option', { name: third });
      expect(
        fetch.mock.calls.some(([url]) => params(String(url)).get('cursor') === 'fresh:' + kind),
      ).toBe(true);
      for (const [url] of fetch.mock.calls.filter(([url]) => String(url).includes('/filters/'))) {
        expect(params(String(url)).has('q')).toBe(false);
        expect(params(String(url)).has('roleTitle')).toBe(false);
        expect(params(String(url)).has('requirementCode')).toBe(false);
      }
    },
  );
});
