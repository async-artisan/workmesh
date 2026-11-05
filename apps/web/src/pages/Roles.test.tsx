import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Roles } from './Roles';
import { setCsrfToken } from '../api/client';
import { invalidateProjects } from '../store/project';
import { bodyOf, envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const project = {
  id: 'p1',
  key: 'DEMO',
  name: 'Demo',
  version: 2,
  defaultKnowledgeBaseId: 'kb-1',
};
const members = [
  { id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'ADMIN', version: 3 },
  { id: 'u2', email: 'bob@example.com', name: 'Bob', role: 'MEMBER', version: 2 },
  { id: 'u3', email: 'charlie@example.com', name: 'Charlie', role: 'MEMBER', version: 1 },
];
const roles = [
  { id: 'r1', projectId: 'p1', key: 'backend', title: '后端', version: 1 },
  { id: 'r2', projectId: 'p1', key: 'reviewer', title: '评审者', version: 1 },
];

function accessView(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeBaseId: 'kb-1',
    projectId: 'p1',
    visibility: 'RESTRICTED',
    version: 4,
    authzVersion: 7,
    publicationApproverUserId: 'u1',
    publicationApproverRoleId: 'r1',
    grants: [
      {
        id: 'g1',
        subjectKind: 'USER',
        subjectUserId: 'u1',
        subjectRoleId: null,
        permissions: ['READ', 'PROPOSE'],
        version: 2,
        grantedAt: '2026-11-01T08:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'g2',
        subjectKind: 'ROLE',
        subjectUserId: null,
        subjectRoleId: 'r1',
        permissions: ['READ'],
        version: 1,
        grantedAt: '2026-11-01T08:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'g3',
        subjectKind: 'USER',
        subjectUserId: 'u3',
        subjectRoleId: null,
        permissions: ['READ'],
        version: 1,
        grantedAt: '2026-10-01T08:00:00.000Z',
        revokedAt: '2026-10-02T08:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function baseHandler(
  options: {
    access?: () => ReturnType<typeof accessView>;
    onReplace?: (body: Record<string, unknown>) => void;
  } = {},
) {
  let currentAccess = accessView();
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/members' && method === 'GET')
      return { status: 200, body: envelope(members) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope(roles) };
    if (path === '/api/v1/knowledge-bases/kb-1/access' && method === 'GET')
      return { status: 200, body: envelope(options.access?.() ?? currentAccess) };
    if (path === '/api/v1/knowledge-bases/kb-1/access' && method === 'PUT') {
      const body = bodyOf(init);
      options.onReplace?.(body);
      currentAccess = {
        ...currentAccess,
        version: currentAccess.version + 1,
        grants: (body.grants as typeof currentAccess.grants).map((grant, index) => ({
          ...grant,
          id: `g-new-${index}`,
          version: 1,
          grantedAt: new Date().toISOString(),
          revokedAt: null,
        })),
      };
      return { status: 200, body: envelope(currentAccess) };
    }
    if (path === '/api/v1/auth/action-previews' && method === 'POST') {
      const binding = bodyOf(init);
      return {
        status: 200,
        body: envelope({
          binding,
          actionDigest: 'digest-acl',
          display: {
            action: 'KB_ACCESS_REPLACE',
            targetType: 'KNOWLEDGE_BASE',
            targetId: 'kb-1',
            expectedVersion: 4,
            projectId: 'p1',
            roleSlot: null,
          },
        }),
      };
    }
    if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          ticketId: 'ticket-1',
          ticketSecret: 'secret-1',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      };
    return undefined;
  };
}

function renderRoles() {
  return render(
    <MemoryRouter>
      <Roles />
    </MemoryRouter>,
  );
}

async function loadAccess() {
  await screen.findByRole('button', { name: '读取访问集合' });
  await waitFor(() => expect(screen.getByRole('button', { name: '读取访问集合' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '读取访问集合' }));
  await screen.findByTestId('acl-overview-table');
}

async function openAclForm() {
  fireEvent.click(screen.getByRole('button', { name: '替换访问集合' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByLabelText('ACL 成员');
  return dialog;
}

describe('Roles ACL 主体管理与布局', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken('csrf-roles');
    invalidateProjects();
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
    invalidateProjects();
    vi.unstubAllGlobals();
  });

  it('集合概览与 grant 明细分别展示，表头与数据列对应', async () => {
    mockFetch(baseHandler());
    renderRoles();
    await loadAccess();

    const overview = screen.getByTestId('acl-overview-table');
    expect(within(overview).getByText('可见性')).toBeInTheDocument();
    expect(within(overview).getByText('集合版本')).toBeInTheDocument();
    expect(within(overview).getByText('授权版本')).toBeInTheDocument();
    expect(within(overview).getByText('出版审批人')).toBeInTheDocument();
    expect(within(overview).getByText('Grant 数量')).toBeInTheDocument();
    expect(within(overview).getByText('受限')).toBeInTheDocument();
    expect(within(overview).getByText('v4')).toBeInTheDocument();
    expect(within(overview).getByText('v7')).toBeInTheDocument();
    expect(within(overview).getByText(/有效 2 条 \/ 共 3 条/)).toBeInTheDocument();

    const detail = screen.getByTestId('acl-detail-table');
    expect(within(detail).getByText('主体')).toBeInTheDocument();
    expect(within(detail).getByText('权限')).toBeInTheDocument();
    expect(within(detail).getByText('版本')).toBeInTheDocument();
    expect(within(detail).getByText('状态')).toBeInTheDocument();
    expect(within(detail).getByText('Alice')).toBeInTheDocument();
    expect(within(detail).getByText('后端（backend）')).toBeInTheDocument();
    expect(within(detail).getByText('读取、提议')).toBeInTheDocument();
    expect(within(detail).getByText('已撤销')).toBeInTheDocument();
    expect(within(detail).getAllByText('有效')).toHaveLength(2);
  });

  it('从成员/角色添加主体、防重复、默认最小权限，并能移除有效 grant', async () => {
    mockFetch(baseHandler());
    renderRoles();
    await loadAccess();
    const dialog = await openAclForm();

    expect(within(dialog).queryByText('Charlie')).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('ACL 成员'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    expect(within(dialog).getAllByTestId('acl-grant-edit')).toHaveLength(3);
    expect(within(dialog).getByRole('checkbox', { name: 'Bob：读取' })).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText('ACL 主体类型'), {
      target: { value: 'ROLE' },
    });
    fireEvent.change(within(dialog).getByLabelText('ACL 角色'), {
      target: { value: 'r2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    expect(within(dialog).getAllByTestId('acl-grant-edit')).toHaveLength(4);

    fireEvent.change(within(dialog).getByLabelText('ACL 主体类型'), {
      target: { value: 'USER' },
    });
    fireEvent.change(within(dialog).getByLabelText('ACL 成员'), { target: { value: 'u2' } });
    expect(within(dialog).getByRole('button', { name: '添加授权主体' })).toBeDisabled();
    expect(within(dialog).getByText('该主体已在授权列表中，不能重复添加。')).toBeInTheDocument();
    expect(within(dialog).getAllByTestId('acl-grant-edit')).toHaveLength(4);

    fireEvent.click(within(dialog).getByRole('button', { name: '移除授权：Bob' }));
    expect(within(dialog).getAllByTestId('acl-grant-edit')).toHaveLength(3);
  });

  it('搜索成员/角色并展示提交前权限 diff，无变化时不伪造变更', async () => {
    mockFetch(baseHandler());
    renderRoles();
    await loadAccess();
    const dialog = await openAclForm();

    expect(within(dialog).getByText('当前没有权限变化；不会提交无意义替换。')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('搜索 ACL 主体'), {
      target: { value: 'bob' },
    });
    expect(within(dialog).getByRole('option', { name: /Bob/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /Alice/ })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('ACL 成员'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    expect(within(dialog).getByTestId('acl-diff-summary')).toHaveTextContent('新增主体：Bob');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Alice：提议' }));
    expect(within(dialog).getByTestId('acl-diff-summary')).toHaveTextContent('移除权限 提议');

    fireEvent.change(within(dialog).getByLabelText('ACL 主体类型'), {
      target: { value: 'ROLE' },
    });
    fireEvent.change(within(dialog).getByLabelText('搜索 ACL 主体'), {
      target: { value: '评审' },
    });
    expect(
      within(within(dialog).getByLabelText('ACL 角色')).getByRole('option', {
        name: /评审者/,
      }),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('搜索 ACL 主体'), {
      target: { value: 'no-such-role' },
    });
    expect(within(dialog).getByText('没有匹配的角色。')).toBeInTheDocument();
  });

  it('确认前展示替换表单，取消不发送 PUT', async () => {
    const mock = mockFetch(baseHandler());
    renderRoles();
    await loadAccess();
    const dialog = await openAclForm();
    fireEvent.change(within(dialog).getByLabelText('ACL 变更原因'), {
      target: { value: '调整授权' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(
      mock.mock.calls.some(
        ([url, init]) =>
          pathOf(String(url)) === '/api/v1/knowledge-bases/kb-1/access' &&
          methodOf(init ?? {}) === 'PUT',
      ),
    ).toBe(false);
  });

  it('确认摘要与精确 payload：USER/ROLE 字段互斥，版本绑定不回归', async () => {
    let putBody: Record<string, unknown> | null = null;
    const mock = mockFetch(
      baseHandler({
        onReplace: (body) => {
          putBody = body;
        },
      }),
    );
    renderRoles();
    await loadAccess();
    const dialog = await openAclForm();

    fireEvent.change(within(dialog).getByLabelText('ACL 成员'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    fireEvent.change(within(dialog).getByLabelText('ACL 主体类型'), {
      target: { value: 'ROLE' },
    });
    fireEvent.change(within(dialog).getByLabelText('ACL 角色'), { target: { value: 'r2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    fireEvent.change(within(dialog).getByLabelText('ACL 变更原因'), {
      target: { value: '扩展知识库访问' },
    });

    await within(dialog).findByLabelText('确认密码');
    fireEvent.change(within(dialog).getByLabelText('确认密码'), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
    expect(await within(dialog).findByText(/票据已签发/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '替换访问集合' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    const body = putBody!;
    expect(body).toMatchObject({
      expectedVersion: 4,
      expectedAuthzVersion: 7,
      visibility: 'RESTRICTED',
      publicationApproverUserId: 'u1',
      publicationApproverRoleId: 'r1',
      reason: '扩展知识库访问',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
    expect(body.grants).toEqual([
      {
        subjectKind: 'USER',
        subjectUserId: 'u1',
        subjectRoleId: null,
        permissions: ['READ', 'PROPOSE'],
      },
      {
        subjectKind: 'ROLE',
        subjectUserId: null,
        subjectRoleId: 'r1',
        permissions: ['READ'],
      },
      {
        subjectKind: 'USER',
        subjectUserId: 'u2',
        subjectRoleId: null,
        permissions: ['READ'],
      },
      {
        subjectKind: 'ROLE',
        subjectUserId: null,
        subjectRoleId: 'r2',
        permissions: ['READ'],
      },
    ]);

    const previewCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/action-previews' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(previewCall?.[1] ?? {})).toMatchObject({
      action: 'KB_ACCESS_REPLACE',
      expectedVersion: 4,
      targetId: 'kb-1',
    });
  });

  it('阻止提交空权限 grant，不发送 PUT', async () => {
    let putCount = 0;
    mockFetch(
      baseHandler({
        onReplace: () => {
          putCount += 1;
        },
      }),
    );
    renderRoles();
    await loadAccess();
    const dialog = await openAclForm();

    fireEvent.change(within(dialog).getByLabelText('ACL 成员'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加授权主体' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bob：读取' }));
    expect(within(dialog).getByText(/每个 grant 至少需要一个权限/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('ACL 变更原因'), {
      target: { value: '错误空权限' },
    });
    await within(dialog).findByLabelText('确认密码');
    fireEvent.change(within(dialog).getByLabelText('确认密码'), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
    await within(dialog).findByText(/票据已签发/);
    fireEvent.click(within(dialog).getByRole('button', { name: '替换访问集合' }));

    expect(await within(dialog).findByText(/至少需要一个权限/)).toBeInTheDocument();
    expect(putCount).toBe(0);
  });

  it('≤720px 成员表降级为卡片列表，管理角色入口在卡内可见', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    mockFetch(baseHandler());
    renderRoles();

    const list = await screen.findByTestId('roles-member-card-list');
    expect(within(list).getByText('Alice')).toBeInTheDocument();
    expect(within(list).getByText('成员版本 v1')).toBeInTheDocument();
    const manageButtons = within(list).getAllByRole('button', { name: '管理角色' });
    expect(manageButtons.length).toBeGreaterThan(0);
    expect(manageButtons[0]).toBeEnabled();
    // 窄屏不再渲染成员表格，避免操作列被横向滚出视口。
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
