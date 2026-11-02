import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import type { ActionBindingInput } from '../api/auth';

const binding: ActionBindingInput = {
  action: 'REVIEW_DECIDE',
  projectId: 'p1',
  targetType: 'REVIEW_REQUEST',
  targetId: 'r1',
  expectedVersion: 3,
  roleSlot: { roleId: 'role-1', approvalSlotId: 'slot-1' },
  payload: { slotId: 'slot-1', decision: 'APPROVE', subjectDigest: 'digest-1', comment: null },
};

const preview = {
  binding,
  actionDigest: 'digest-a',
  display: {
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    projectId: binding.projectId,
    roleSlot: binding.roleSlot,
  },
};

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const fetchMock = vi.fn();

describe('ConfirmationPrompt（action preview + 密码二验 + 单次票据）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('digest 被服务端判定变化时展示 409 ACTION_CHANGED，且不签发票据', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: preview }))
      .mockResolvedValueOnce(
        json(409, {
          error: { code: 'ACTION_CHANGED', message: '动作内容已变更，请重新预览', requestId: 'req-2' },
        }),
      );

    render(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        onClose={() => undefined}
        onConfirmed={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-a');
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('[ACTION_CHANGED] 动作内容已变更，请重新预览');
    expect(screen.queryByText(/票据已签发/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
  });

  it('票据过期（410）在执行业务写操作时原样展示，不显示成功', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: preview }))
      .mockResolvedValueOnce(
        json(201, {
          data: {
            ticketId: 't1',
            ticketSecret: 's1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            actionDigest: 'digest-a',
          },
        }),
      );

    const onConfirmed = vi.fn().mockRejectedValue(
      new ApiError(410, 'CONFIRMATION_EXPIRED', '票据已过期', { ticketId: 't1' }, 'req-3'),
    );
    const onClose = vi.fn();

    render(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        submitLabel="提交决定"
        onClose={onClose}
        onConfirmed={onConfirmed}
      />,
    );

    expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-a');
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));

    expect(await screen.findByText(/票据已签发/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交决定' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('[CONFIRMATION_EXPIRED] 票据已过期'),
    );
    expect(onConfirmed).toHaveBeenCalledWith({ ticketId: 't1', ticketSecret: 's1' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
