import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InviteMemberDialog } from './InviteMemberDialog';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const roles = [
  { id: 'r-backend', projectId: 'p1', key: 'backend', title: '后端', isActive: true },
  { id: 'r-qa', projectId: 'p1', key: 'qa', title: '测试', isActive: true },
];

function handler() {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/action-previews' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          binding: bodyOf(init),
          actionDigest: 'a'.repeat(64),
          display: {
            action: 'PROJECT_INVITATION_CREATE',
            targetType: 'PROJECT_INVITATION',
            targetId: 'p1',
            expectedVersion: 3,
            projectId: 'p1',
            roleSlot: null,
          },
        }),
      };
    if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          ticketId: 't-1',
          ticketSecret: 'secret-1',
          expiresAt: '2026-11-03T00:05:00.000Z',
          actionDigest: 'a'.repeat(64),
        }),
      };
    if (path === '/api/v1/projects/p1/invitations' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          id: 'inv-1',
          token: 'wmi_test_token',
          projectId: 'p1',
          roleIds: ['r-backend'],
          roleKeys: ['backend'],
          email: null,
          expiresAt: '2026-11-06T00:00:00.000Z',
          replayed: false,
        }),
      };
    return undefined;
  };
}

function renderDialog() {
  return render(
    <InviteMemberDialog
      open
      projectId="p1"
      projectVersion={3}
      roles={roles}
      onClose={() => undefined}
    />,
  );
}

describe('InviteMemberDialog', () => {
  beforeEach(() => setCsrfToken('csrf-1'));
  afterEach(() => setCsrfToken(null));

  it('选角色 → 票据 → 生成一次性邀请链接', async () => {
    const mock = mockFetch(handler());

    renderDialog();

    fireEvent.click(screen.getByLabelText('邀请角色 backend'));
    fireEvent.click(screen.getByRole('button', { name: '生成邀请链接' }));

    fireEvent.change(await screen.findByLabelText('确认密码'), {
      target: { value: 'my-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成链接' }));

    const link = await screen.findByText(/只显示一次/);
    expect(link).toBeInTheDocument();
    const input = screen.getByLabelText('邀请链接') as HTMLInputElement;
    expect(input.value).toContain('/invite/wmi_test_token');

    const preview = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/action-previews' && methodOf(init ?? {}) === 'POST',
    );
    const previewBody = bodyOf(preview?.[1] ?? {});
    expect(previewBody).toMatchObject({
      action: 'PROJECT_INVITATION_CREATE',
      targetId: 'p1',
      expectedVersion: 3,
      payload: { roleIds: ['r-backend'], email: null, expiresInHours: 72 },
    });

    const create = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/invitations' &&
        methodOf(init ?? {}) === 'POST',
    );
    const createBody = bodyOf(create?.[1] ?? {});
    expect(createBody).toMatchObject({
      roleKeys: ['backend'],
      expiresInHours: 72,
      expectedVersion: 3,
      confirmation: { ticketId: 't-1', ticketSecret: 'secret-1' },
    });
    expect(createBody.email).toBeUndefined();
  });

  it('没选角色时不能生成', () => {
    mockFetch(handler());
    renderDialog();
    expect(screen.getByRole('button', { name: '生成邀请链接' })).toBeDisabled();
  });

  it('动作预览读取中：确认弹窗显示 role="status"，签发按钮禁用，读完才可继续', async () => {
    let releasePreview: (value: { status: number; body: unknown }) => void = () => undefined;
    const previewReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      releasePreview = resolve;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/auth/action-previews' && methodOf(init) === 'POST')
        return previewReply;
      return handler()(url, init);
    });

    renderDialog();
    fireEvent.click(screen.getByLabelText('邀请角色 backend'));
    fireEvent.click(screen.getByRole('button', { name: '生成邀请链接' }));

    const prompt = await screen.findByRole('dialog', { name: '确认生成邀请链接' });
    const loadingRegion = within(prompt).getByRole('status');
    expect(loadingRegion).toHaveTextContent('正在读取服务端动作预览…');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(within(prompt).getByRole('button', { name: '读取动作预览中…' })).toBeDisabled();
    expect(within(prompt).queryByLabelText('确认密码')).not.toBeInTheDocument();

    await act(async () => {
      releasePreview({
        status: 201,
        body: envelope({
          binding: {
            action: 'PROJECT_INVITATION_CREATE',
            projectId: 'p1',
            targetType: 'PROJECT_INVITATION',
            targetId: 'p1',
            expectedVersion: 3,
            roleSlot: null,
            payload: { roleIds: ['r-backend'], email: null, expiresInHours: 72 },
          },
          actionDigest: 'a'.repeat(64),
          display: {
            action: 'PROJECT_INVITATION_CREATE',
            targetType: 'PROJECT_INVITATION',
            targetId: 'p1',
            expectedVersion: 3,
            projectId: 'p1',
            roleSlot: null,
          },
        }),
      });
    });

    expect(await within(prompt).findByLabelText('确认密码')).toBeInTheDocument();
    fireEvent.change(within(prompt).getByLabelText('确认密码'), { target: { value: 'pw' } });
    expect(within(prompt).getByRole('button', { name: '验证密码并签发票据' })).toBeEnabled();
    expect(within(prompt).queryByRole('status')).not.toBeInTheDocument();
  });
});
