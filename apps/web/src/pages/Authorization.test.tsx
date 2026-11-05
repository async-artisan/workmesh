import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Authorization, authorizationStatusOf, groupAuthorizationScopes } from './Authorization';
import { invalidateProjects } from '../store/project';
import { SCOPE_REGISTRY } from '@workmesh/shared';
import { bodyOf, envelope, methodOf, mockFetch, pathOf, type StubReply } from '../test-utils';

const DAY_MS = 24 * 60 * 60 * 1000;
const projectOne = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const projectTwo = { id: 'p2', key: 'OPS', name: 'Ops', version: 1 };
const roleOne = { id: 'role-1', projectId: 'p1', key: 'backend', title: '后端', version: 1 };
const roleTwo = { id: 'role-2', projectId: 'p2', key: 'reviewer', title: '评审者', version: 1 };

function pendingLookup(overrides: Record<string, unknown> = {}) {
  return {
    authorizationId: 'auth-1',
    clientName: 'WorkMesh CLI',
    status: 'PENDING',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    version: 3,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Reply = { status: number; body: unknown };

function baseHandler(overrides: {
  lookup?: (code: string) => Reply | Promise<Reply | undefined> | undefined;
  approve?: (body: Record<string, unknown>) => Reply | undefined;
  deny?: (body: Record<string, unknown>) => Reply | undefined;
  projects?: () => Reply | undefined;
  roles?: (projectId: string) => Reply | undefined;
}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return overrides.projects?.() ?? { status: 200, body: envelope([projectOne, projectTwo]) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return overrides.roles?.('p1') ?? { status: 200, body: envelope([roleOne]) };
    if (path === '/api/v1/projects/p2/roles' && method === 'GET')
      return overrides.roles?.('p2') ?? { status: 200, body: envelope([roleTwo]) };
    if (path === '/api/v1/auth/cli-authorizations/lookup' && method === 'POST') {
      const body = bodyOf(init);
      return overrides.lookup?.(String(body.userCode));
    }
    if (path === '/api/v1/auth/cli-authorizations/auth-1/approve' && method === 'POST')
      return overrides.approve?.(bodyOf(init));
    if (path === '/api/v1/auth/cli-authorizations/auth-1/deny' && method === 'POST')
      return overrides.deny?.(bodyOf(init));
    return undefined;
  };
}

function renderAuthorization() {
  return render(
    <MemoryRouter>
      <Authorization />
    </MemoryRouter>,
  );
}

async function submitCode(code: string) {
  const input = screen.getByLabelText('授权码');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form')!);
}

async function chooseProjectAndRole(project = 'p1', role = 'role-1') {
  await screen.findByLabelText('授权项目');
  fireEvent.change(screen.getByLabelText('授权项目'), { target: { value: project } });
  await waitFor(() =>
    expect(
      screen.getByRole('option', { name: role === 'role-1' ? '后端' : '评审者' }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText('授权角色'), { target: { value: role } });
}

function approveCalls(mock: ReturnType<typeof mockFetch>) {
  return mock.mock.calls.filter(
    ([url, init]) =>
      pathOf(String(url)) === '/api/v1/auth/cli-authorizations/auth-1/approve' &&
      methodOf(init ?? {}) === 'POST',
  );
}

describe('authorizationStatusOf（真实状态映射）', () => {
  it('映射 PENDING/APPROVED/DENIED/ISSUED，PENDING 过期视为已过期，未知保留原始状态', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(authorizationStatusOf({ status: 'PENDING', expiresAt: future })).toMatchObject({
      kind: 'pending',
      label: '待处理',
      canApprove: true,
    });
    expect(authorizationStatusOf({ status: 'PENDING', expiresAt: past })).toMatchObject({
      kind: 'expired',
      canApprove: false,
    });
    expect(authorizationStatusOf({ status: 'PENDING', expiresAt: 'not-a-date' })).toMatchObject({
      kind: 'unknown',
      label: '状态待确认',
      canApprove: false,
    });
    expect(
      authorizationStatusOf({
        status: 'PENDING',
        expiresAt: undefined as unknown as string,
      }),
    ).toMatchObject({
      kind: 'unknown',
      canApprove: false,
    });
    expect(authorizationStatusOf({ status: 'APPROVED', expiresAt: future }).label).toBe(
      '已批准，等待 CLI 领取',
    );
    expect(authorizationStatusOf({ status: 'DENIED', expiresAt: future }).label).toBe('已拒绝');
    expect(authorizationStatusOf({ status: 'ISSUED', expiresAt: future }).label).toBe('已签发');
    expect(authorizationStatusOf({ status: 'FUTURE_STATUS', expiresAt: future })).toMatchObject({
      kind: 'unknown',
      label: '状态待确认',
      raw: 'FUTURE_STATUS',
      canApprove: false,
    });
  });
});

describe('Authorization（设备授权确认与查询恢复）', () => {
  beforeEach(() => {
    invalidateProjects();
    localStorage.clear();
  });

  afterEach(() => {
    invalidateProjects();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('展示可见授权码标签与 CLI 指引，Enter/表单提交后查询', async () => {
    const mock = mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
      }),
    );
    renderAuthorization();

    expect(screen.getByLabelText('授权码')).toBeInTheDocument();
    expect(screen.getAllByText(/workmesh auth login/).length).toBeGreaterThan(0);
    await submitCode('abcd-efgh');
    expect(await screen.findByText('WorkMesh CLI')).toBeInTheDocument();
    expect(screen.getByText('待处理')).toBeInTheDocument();

    const lookupCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/cli-authorizations/lookup' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(lookupCall?.[1] ?? {})).toEqual({ userCode: 'ABCD-EFGH' });
  });

  it('查询失败显示可读错误与折叠详情，可重新查询恢复', async () => {
    let calls = 0;
    mockFetch(
      baseHandler({
        lookup: () => {
          calls += 1;
          if (calls === 1)
            return {
              status: 404,
              body: {
                error: {
                  code: 'RESOURCE_NOT_FOUND',
                  message: '授权请求不存在',
                  requestId: 'req-lookup',
                },
              },
            };
          return { status: 200, body: envelope(pendingLookup()) };
        },
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');

    expect(await screen.findByText('查询授权请求失败')).toBeInTheDocument();
    expect(screen.getByText(/授权码不存在或已过期/)).toBeInTheDocument();
    const details = screen.getByRole('alert').querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('RESOURCE_NOT_FOUND');
    expect(details).toHaveTextContent('req-lookup');
    fireEvent.click(screen.getByRole('button', { name: '重新查询设备授权请求' }));
    expect(await screen.findByText('WorkMesh CLI')).toBeInTheDocument();
  });

  it('未知状态显示状态待确认和原始状态，不显示批准入口', async () => {
    mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup({ status: 'FUTURE_STATUS' })) }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');

    expect(await screen.findByText('WorkMesh CLI')).toBeInTheDocument();
    expect(screen.getByText('状态待确认')).toBeInTheDocument();
    expect(screen.getByText(/FUTURE_STATUS/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准授权' })).not.toBeInTheDocument();
  });

  it('修改授权码清除旧详情，迟到的旧查询不能覆盖新授权', async () => {
    const first = deferred<StubReply>();
    const handler = baseHandler({
      lookup: (code) =>
        code === 'AAAA-AAAA'
          ? first.promise
          : { status: 200, body: envelope(pendingLookup({ clientName: '新客户端' })) },
    });
    mockFetch(handler);
    renderAuthorization();
    await submitCode('AAAA-AAAA');
    expect(screen.queryByText('WorkMesh CLI')).not.toBeInTheDocument();

    await submitCode('BBBB-BBBB');
    expect(await screen.findByText('新客户端')).toBeInTheDocument();
    first.resolve({ status: 200, body: envelope(pendingLookup({ clientName: '旧客户端' })) });
    await waitFor(() => expect(screen.queryByText('旧客户端')).not.toBeInTheDocument());
    expect(screen.getByText('新客户端')).toBeInTheDocument();
  });

  it('切换项目清除旧角色，角色加载失败可重试', async () => {
    let p2RoleCalls = 0;
    mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
        roles: (projectId) => {
          if (projectId !== 'p2') return { status: 200, body: envelope([roleOne]) };
          p2RoleCalls += 1;
          if (p2RoleCalls === 1)
            return {
              status: 503,
              body: { error: { code: 'ROLES_UNAVAILABLE', message: '角色服务不可用' } },
            };
          return { status: 200, body: envelope([roleTwo]) };
        },
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    await chooseProjectAndRole();
    expect(screen.getByLabelText('授权角色')).toHaveValue('role-1');

    fireEvent.change(screen.getByLabelText('授权项目'), { target: { value: 'p2' } });
    await waitFor(() => expect(screen.getByLabelText('授权角色')).toHaveValue(''));
    expect(await screen.findByText(/暂时无法读取项目角色/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载角色' }));
    await waitFor(() => expect(screen.getByRole('option', { name: '评审者' })).toBeInTheDocument());
  });

  it('非待处理授权（已批准）不显示批准入口', async () => {
    mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup({ status: 'APPROVED' })) }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');

    expect(await screen.findByText('已批准，等待 CLI 领取')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝授权' })).not.toBeInTheDocument();
  });

  it('项目列表读取失败可重试，恢复后可以选择项目', async () => {
    let projectCalls = 0;
    mockFetch(
      baseHandler({
        projects: () => {
          projectCalls += 1;
          if (projectCalls === 1)
            return {
              status: 503,
              body: { error: { code: 'PROJECTS_UNAVAILABLE', message: '项目服务不可用' } },
            };
          return { status: 200, body: envelope([projectOne]) };
        },
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    expect(await screen.findByText(/暂时无法读取项目列表/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载项目' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Demo/ })).toBeInTheDocument());
    expect(projectCalls).toBe(2);
  });

  it('旧查询迟到的失败响应不能覆盖新授权', async () => {
    const oldLookup = deferred<StubReply>();
    mockFetch(
      baseHandler({
        lookup: (code) =>
          code === 'AAAA-AAAA'
            ? oldLookup.promise
            : { status: 200, body: envelope(pendingLookup({ clientName: '新客户端' })) },
      }),
    );
    renderAuthorization();
    await submitCode('AAAA-AAAA');
    await submitCode('BBBB-BBBB');
    expect(await screen.findByText('新客户端')).toBeInTheDocument();

    oldLookup.resolve({
      status: 404,
      body: {
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: '旧请求不存在',
          requestId: 'req-old',
        },
      },
    });
    await waitFor(() => expect(screen.queryByText(/旧请求不存在/)).not.toBeInTheDocument());
    expect(screen.getByText('新客户端')).toBeInTheDocument();
  });

  it('已过期或非待处理授权不显示批准入口', async () => {
    mockFetch(
      baseHandler({
        lookup: () => ({
          status: 200,
          body: envelope(pendingLookup({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
        }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    expect(await screen.findByText('已过期')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝授权' })).not.toBeInTheDocument();
  });

  it('PENDING 但 expiresAt 不可解析时不显示操作入口，也不打开确认或发送审批请求', async () => {
    const mock = mockFetch(
      baseHandler({
        lookup: () => ({
          status: 200,
          body: envelope(pendingLookup({ expiresAt: 'not-a-date' })),
        }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');

    expect(await screen.findByText('状态待确认')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      mock.mock.calls.filter(([url]) =>
        /\/cli-authorizations\/[^/]+\/(approve|deny)$/.test(pathOf(String(url))),
      ),
    ).toHaveLength(0);
  });

  it('有效期 1 和 30 可用，空值、0、31、小数均不能提交', async () => {
    mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    await chooseProjectAndRole();
    const expiry = screen.getByLabelText('有效期（天）');
    const approve = screen.getByRole('button', { name: '批准授权' });

    fireEvent.change(expiry, { target: { value: '1' } });
    expect(approve).toBeEnabled();
    fireEvent.change(expiry, { target: { value: '30' } });
    expect(approve).toBeEnabled();
    for (const value of ['', '0', '31', '1.5']) {
      fireEvent.change(expiry, { target: { value } });
      expect(approve).toBeDisabled();
      expect(screen.getAllByText(/有效期必须是 1–30 的整数天|请输入有效期/).length).toBeGreaterThan(
        0,
      );
    }
  });

  it('scope 中文分组、默认最小权限、清除选择与未知值保留', async () => {
    mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    await chooseProjectAndRole();

    expect(screen.getByRole('checkbox', { name: '只读：项目读取' })).toBeChecked();
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.getByText('写入与提案')).toBeInTheDocument();
    expect(screen.getByText('任务执行')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(SCOPE_REGISTRY.length);

    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.getByRole('button', { name: '批准授权' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '任务执行：领取任务' }));
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();

    const grouped = groupAuthorizationScopes(['project:read', 'future:permission']);
    expect(grouped.unknownSelected).toEqual(['future:permission']);
  });

  it('批准前显示完整确认摘要，取消不发请求，确认后 payload 精确', async () => {
    const mock = mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
        approve: () => ({
          status: 200,
          body: envelope({ authorizationId: 'auth-1', status: 'APPROVED', version: 4 }),
        }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    await chooseProjectAndRole();
    fireEvent.change(screen.getByLabelText('有效期（天）'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '任务执行：领取任务' }));
    fireEvent.click(screen.getByRole('button', { name: '批准授权' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/WorkMesh CLI/)).toBeInTheDocument();
    expect(within(dialog).getByText(/待处理/)).toBeInTheDocument();
    expect(within(dialog).getByText(/v3/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Demo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/后端/)).toBeInTheDocument();
    expect(within(dialog).getByText(/项目读取（project:read）/)).toBeInTheDocument();
    expect(within(dialog).getByText(/领取任务（task:claim）/)).toBeInTheDocument();
    expect(within(dialog).getByText(/有效期：7 天/)).toBeInTheDocument();
    expect(within(dialog).getByText(/预计到期/)).toBeInTheDocument();
    expect(within(dialog).getByText(/已扩大/)).toBeInTheDocument();
    expect(within(dialog).getByText(/不是密码验证/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(approveCalls(mock)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '批准授权' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认批准授权' }));
    expect(await screen.findByText(/授权结果：已批准，等待 CLI 领取/)).toBeInTheDocument();
    expect(approveCalls(mock)).toHaveLength(1);
    expect(bodyOf(approveCalls(mock)[0]?.[1] ?? {})).toEqual({
      expectedVersion: 3,
      projectId: 'p1',
      roleId: 'role-1',
      scopes: ['project:read', 'task:claim'],
      expiresInDays: 7,
    });
  });

  it('批准失败显示可读错误和技术详情，拒绝成功后状态中文化', async () => {
    let approveCallsCount = 0;
    const mock = mockFetch(
      baseHandler({
        lookup: () => ({ status: 200, body: envelope(pendingLookup()) }),
        approve: () => {
          approveCallsCount += 1;
          return {
            status: 410,
            body: {
              error: {
                code: 'AUTHORIZATION_EXPIRED',
                message: '授权请求已过期',
                requestId: 'req-expired',
              },
            },
          };
        },
        deny: () => ({
          status: 200,
          body: envelope({ authorizationId: 'auth-1', status: 'DENIED', version: 4 }),
        }),
      }),
    );
    renderAuthorization();
    await submitCode('ABCD-EFGH');
    await chooseProjectAndRole();
    fireEvent.click(screen.getByRole('button', { name: '批准授权' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认批准授权' }));

    expect((await screen.findAllByText(/授权请求已过期/)).length).toBeGreaterThan(0);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('AUTHORIZATION_EXPIRED');
    expect(alert).toHaveTextContent('req-expired');
    expect(approveCallsCount).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '拒绝授权' }));
    expect(await screen.findByText(/授权结果：已拒绝/)).toBeInTheDocument();
    const denyCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/cli-authorizations/auth-1/deny' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(denyCall?.[1] ?? {})).toEqual({ expectedVersion: 3 });
  });
});
