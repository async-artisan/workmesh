import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Profile,
  CREDENTIAL_EXPIRING_DAYS,
  credentialStatus,
  groupCredentialScopes,
  type CredentialView,
} from './Profile';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

const projectOne = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const projectTwo = { id: 'p2', key: 'OPS', name: 'Ops', version: 1 };
const roleOne = { id: 'role-1', projectId: 'p1', key: 'backend', title: '后端', version: 1 };
const roleTwo = { id: 'role-2', projectId: 'p2', key: 'reviewer', title: '评审者', version: 1 };

function credential(overrides: Partial<CredentialView> = {}): CredentialView {
  const id = overrides.id ?? 'cred-1';
  return {
    id,
    name: `CLI ${id}`,
    projectId: 'p1',
    roleId: 'role-1',
    scopes: ['project:read', 'task:claim'],
    expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function baseHandler(options: {
  credentials: () => CredentialView[];
  revoke?: { status: number; body: unknown };
}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/credentials' && method === 'GET')
      return { status: 200, body: envelope(options.credentials()) };
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([projectOne, projectTwo]) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope([roleOne]) };
    if (path === '/api/v1/projects/p2/roles' && method === 'GET')
      return { status: 200, body: envelope([roleTwo]) };
    if (/^\/api\/v1\/auth\/credentials\/[^/]+$/.test(path) && method === 'DELETE')
      return options.revoke ?? { status: 200, body: envelope({ revoked: true }) };
    return undefined;
  };
}

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

function tableRows() {
  return within(screen.getByTestId('credentials-table')).getAllByRole('row').slice(1);
}

describe('credentialStatus（凭据状态优先级）', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');

  it('已吊销优先于已过期，已过期优先于即将过期，边界固定为 7 天', () => {
    expect(
      credentialStatus(
        { expiresAt: '2020-01-01T00:00:00.000Z', revokedAt: '2026-11-01T00:00:00.000Z' },
        now,
      ),
    ).toBe('revoked');
    expect(credentialStatus({ expiresAt: now.toISOString(), revokedAt: null }, now)).toBe(
      'expired',
    );
    expect(
      credentialStatus(
        {
          expiresAt: new Date(now.getTime() + CREDENTIAL_EXPIRING_DAYS * DAY_MS).toISOString(),
          revokedAt: null,
        },
        now,
      ),
    ).toBe('expiring');
    expect(
      credentialStatus(
        {
          expiresAt: new Date(
            now.getTime() + (CREDENTIAL_EXPIRING_DAYS + 1) * DAY_MS,
          ).toISOString(),
          revokedAt: null,
        },
        now,
      ),
    ).toBe('valid');
    expect(credentialStatus({ expiresAt: 'not-a-date', revokedAt: null }, now)).toBe('unknown');
  });
});

describe('groupCredentialScopes（scope 分组与未知保留）', () => {
  it('已知 scope 按只读/写入提案/任务/评审/集成分组，未知 scope 不丢弃', () => {
    const grouping = groupCredentialScopes([
      'project:read',
      'requirement:propose',
      'task:claim',
      'review:request',
      'integrations:receive',
      'future:permission',
    ]);
    expect(grouping.groups.map((group) => group.label)).toEqual([
      '只读',
      '写入与提案',
      '任务执行',
      '评审与变更',
      '集成协作',
    ]);
    expect(grouping.unknown).toEqual(['future:permission']);
    expect(grouping.groups[0].items[0]).toMatchObject({ value: 'project:read', label: '项目读取' });
  });
});

describe('Profile（Agent 凭据状态、权限与吊销）', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken('csrf-profile');
    useAuthStore.getState().setSession({ id: 'user-1', email: 'user@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
    useAuthStore.getState().clearAuth();
    vi.unstubAllGlobals();
  });

  it('展示有效、即将过期、已过期、已吊销状态，并禁用失效凭据的吊销入口', async () => {
    const credentials = [
      credential({ id: 'valid', name: '有效凭据' }),
      credential({
        id: 'expiring',
        name: '即将过期凭据',
        expiresAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      }),
      credential({
        id: 'expired',
        name: '已过期凭据',
        expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
      }),
      credential({
        id: 'revoked',
        name: '已吊销凭据',
        revokedAt: new Date(Date.now() - DAY_MS).toISOString(),
        expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
      }),
    ];
    mockFetch(baseHandler({ credentials: () => credentials }));

    renderProfile();
    await screen.findAllByText('有效凭据');
    const table = within(screen.getByTestId('credentials-table'));

    expect(table.getAllByText('有效').length).toBeGreaterThan(0);
    expect(table.getAllByText('即将过期').length).toBeGreaterThan(0);
    expect(table.getAllByText('已过期').length).toBeGreaterThan(0);
    expect(table.getAllByText('已吊销').length).toBeGreaterThan(0);
    expect(table.getByRole('button', { name: '已过期，不可撤销' })).toBeDisabled();
    expect(table.getByRole('button', { name: '已吊销，不可撤销' })).toBeDisabled();
    expect(table.getAllByRole('button', { name: '吊销凭据' })).toHaveLength(2);
  });

  it('有效凭据吊销确认说明会立即失效、需重新授权，确认按钮为危险样式', async () => {
    let revoked = false;
    const credentials = () => [
      credential({
        id: 'cred-1',
        name: 'CLI codex-cli',
        revokedAt: revoked ? new Date().toISOString() : null,
      }),
    ];
    const handler = baseHandler({
      credentials,
      revoke: { status: 200, body: envelope({ revoked: true }) },
    });
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (/^\/api\/v1\/auth\/credentials\/[^/]+$/.test(path) && method === 'DELETE') {
        revoked = true;
      }
      return handler(url, init);
    });

    renderProfile();
    await screen.findAllByText('CLI codex-cli');
    fireEvent.click(
      within(screen.getByTestId('credentials-table')).getByRole('button', { name: '吊销凭据' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/会立即失效/)).toBeInTheDocument();
    expect(within(dialog).getByText(/必须重新通过 CLI 设备授权/)).toBeInTheDocument();
    expect(within(dialog).getByText(/凭据记录会保留，项目数据不会被删除/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: '确认吊销凭据' });
    expect(confirm).toHaveClass('danger');

    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText(/凭据已吊销，立即失效/)).toBeInTheDocument());
    await waitFor(() =>
      expect(
        within(screen.getByTestId('credentials-table')).getAllByText('已吊销').length,
      ).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByTestId('credentials-table')).getByRole('button', {
        name: '已吊销，不可撤销',
      }),
    ).toBeDisabled();
  });

  it('吊销失败显示可读错误和技术详情，保留列表并允许重试', async () => {
    mockFetch(
      baseHandler({
        credentials: () => [credential({ id: 'cred-1', name: '失败凭据' })],
        revoke: {
          status: 500,
          body: { error: { code: 'REVOKE_FAILED', message: '吊销失败', requestId: 'req-revoke' } },
        },
      }),
    );

    renderProfile();
    await screen.findAllByText('失败凭据');
    fireEvent.click(
      within(screen.getByTestId('credentials-table')).getByRole('button', { name: '吊销凭据' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '确认吊销凭据' }));

    expect(await screen.findByText('撤销凭据失败，请稍后重试。')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('credentials-table')).getByText('失败凭据'),
    ).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('REVOKE_FAILED');
    expect(details).toHaveTextContent('req-revoke');
    expect(screen.getByRole('button', { name: '确认吊销凭据' })).toBeEnabled();
  });

  it('已知 scope 分组展示中文说明，未知 scope 标记为未识别权限并保留技术值', async () => {
    mockFetch(
      baseHandler({
        credentials: () => [
          credential({
            id: 'scope-cred',
            name: '权限凭据',
            scopes: ['project:read', 'task:claim', 'review:request', 'future:permission'],
          }),
        ],
      }),
    );

    renderProfile();
    await screen.findAllByText('权限凭据');
    const row = within(screen.getByTestId('credentials-table')).getByText('权限凭据').closest('tr');
    if (!row) throw new Error('缺少凭据行');
    fireEvent.click(within(row).getByText('查看权限明细'));

    expect(within(row).getByText('只读')).toBeInTheDocument();
    expect(within(row).getByText('任务执行')).toBeInTheDocument();
    expect(within(row).getByText('评审与变更')).toBeInTheDocument();
    expect(within(row).getByText('未识别权限')).toBeInTheDocument();
    expect(within(row).getByText('future:permission')).toBeInTheDocument();
    expect(within(row).getByText(/技术值：project:read, task:claim/)).toBeInTheDocument();
  });

  it('按项目、角色、状态筛选并排序，无匹配时提供清除筛选', async () => {
    const credentials = [
      credential({ id: 'alpha', name: 'alpha', projectId: 'p1', roleId: 'role-1' }),
      credential({
        id: 'beta',
        name: 'beta',
        projectId: 'p2',
        roleId: 'role-2',
        expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
      }),
      credential({
        id: 'gamma',
        name: 'gamma',
        projectId: 'p1',
        roleId: 'role-2',
        expiresAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      }),
    ];
    mockFetch(baseHandler({ credentials: () => credentials }));
    renderProfile();
    await screen.findAllByText('alpha');

    fireEvent.change(screen.getByLabelText('按项目筛选'), { target: { value: 'p1' } });
    expect(tableRows()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('按角色筛选'), { target: { value: 'role-2' } });
    expect(tableRows()).toHaveLength(1);
    expect(tableRows()[0]).toHaveTextContent('gamma');

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'expired' } });
    expect(screen.getByText('当前筛选没有匹配的凭据')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0]);

    expect(tableRows()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('凭据排序'), { target: { value: 'name' } });
    expect(tableRows()[0]).toHaveTextContent('alpha');
  });

  it('同名凭据通过项目、角色和凭据短 ID 辅助区分', async () => {
    mockFetch(
      baseHandler({
        credentials: () => [
          credential({
            id: 'same-credential-id-one',
            name: 'CLI codex-cli',
            projectId: 'p1',
            roleId: 'role-1',
          }),
          credential({
            id: 'same-credential-id-two',
            name: 'CLI codex-cli',
            projectId: 'p2',
            roleId: 'role-2',
          }),
        ],
      }),
    );

    renderProfile();
    await screen.findAllByText('CLI codex-cli');
    const rows = tableRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Demo');
    expect(rows[0]).toHaveTextContent('后端');
    expect(rows[1]).toHaveTextContent('Ops');
    expect(rows[1]).toHaveTextContent('评审者');
    expect(rows[0]).toHaveTextContent(/凭据 ID same-cre/);
    expect(rows[1]).toHaveTextContent(/凭据 ID same-cre/);
  });

  it('首次加载失败显示页面错误而不是空列表，重试后恢复', async () => {
    let reads = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/auth/credentials' && method === 'GET') {
        reads += 1;
        if (reads === 1)
          return {
            status: 503,
            body: { error: { code: 'CREDENTIALS_UNAVAILABLE', message: '凭据服务不可用' } },
          };
        return {
          status: 200,
          body: envelope([credential({ id: 'recovered', name: '恢复后的凭据' })]),
        };
      }
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([projectOne]) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return { status: 200, body: envelope([roleOne]) };
      return undefined;
    });

    renderProfile();
    expect(await screen.findByText('无法读取 Agent 凭据')).toBeInTheDocument();
    expect(screen.queryByText('还没有 Agent 凭据')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载 Agent 凭据' }));
    expect(await screen.findAllByText('恢复后的凭据')).not.toHaveLength(0);
  });

  it('刷新失败保留旧凭据并显示 stale 提示和重试', async () => {
    let reads = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/auth/credentials' && method === 'GET') {
        reads += 1;
        if (reads === 1)
          return { status: 200, body: envelope([credential({ id: 'kept', name: '保留的凭据' })]) };
        return {
          status: 500,
          body: { error: { code: 'CREDENTIALS_UNAVAILABLE', message: '刷新失败' } },
        };
      }
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([projectOne]) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return { status: 200, body: envelope([roleOne]) };
      return undefined;
    });

    renderProfile();
    expect(await screen.findAllByText('保留的凭据')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '刷新凭据' }));
    expect(await screen.findByText('本次刷新失败，数据可能已过期。')).toBeInTheDocument();
    expect(screen.getAllByText('保留的凭据').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重试刷新 Agent 凭据' })).toBeInTheDocument();
  });

  it('窄屏卡片包含状态、项目/角色、scope 摘要和操作，筛选与权限详情可聚焦', async () => {
    mockFetch(
      baseHandler({
        credentials: () => [
          credential({
            id: 'card-credential',
            name: '卡片凭据',
            scopes: ['project:read', 'task:claim', 'unknown:scope'],
          }),
        ],
      }),
    );

    renderProfile();
    await screen.findAllByText('卡片凭据');
    const cards = screen.getByTestId('credentials-cards');
    expect(within(cards).getByText('卡片凭据')).toBeInTheDocument();
    expect(within(cards).getByText('有效')).toBeInTheDocument();
    expect(within(cards).getByText(/Demo · 后端/)).toBeInTheDocument();
    expect(within(cards).getByText(/到期：/)).toBeInTheDocument();
    expect(within(cards).getByText('只读')).toBeInTheDocument();
    expect(within(cards).getByText('任务执行')).toBeInTheDocument();
    expect(within(cards).getByText('未识别权限')).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: '吊销凭据', hidden: true })).toBeEnabled();

    const statusSelect = screen.getByLabelText('按状态筛选');
    statusSelect.focus();
    expect(statusSelect).toHaveFocus();
    const summary = within(cards).getByText('查看权限明细');
    summary.focus();
    expect(summary).toHaveFocus();
  });

  it('凭据空态给出 CLI 命令、复制入口和设备授权跳转，不伪造 Web 创建', async () => {
    mockFetch(baseHandler({ credentials: () => [] }));
    renderProfile();

    expect(await screen.findByTestId('profile-empty-credentials')).toBeInTheDocument();
    expect(screen.getByText('还没有 Agent 凭据')).toBeInTheDocument();
    expect(screen.getByText('workmesh auth login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制 CLI 命令' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开设备授权' })).toHaveAttribute(
      'href',
      '/authorization',
    );
    expect(screen.queryByRole('button', { name: /创建.*凭据/ })).not.toBeInTheDocument();
  });
});
