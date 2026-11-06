import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import type { DecisionSummaryData } from './DecisionSummary';
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
    fetchMock.mockResolvedValueOnce(json(200, { data: preview })).mockResolvedValueOnce(
      json(409, {
        error: {
          code: 'ACTION_CHANGED',
          message: '动作内容已变更，请重新预览',
          requestId: 'req-2',
        },
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[ACTION_CHANGED] 动作内容已变更，请重新预览',
    );
    expect(screen.queryByText(/票据已签发/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
  });

  it('票据过期（410）在执行业务写操作时原样展示，不显示成功', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: preview })).mockResolvedValueOnce(
      json(201, {
        data: {
          ticketId: 't1',
          ticketSecret: 's1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          actionDigest: 'digest-a',
        },
      }),
    );

    const onConfirmed = vi
      .fn()
      .mockRejectedValue(
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

describe('ConfirmationPrompt（业务决定摘要）', () => {
  const summary: DecisionSummaryData = {
    decision: 'APPROVE',
    subject: 'DEMO-REQ-1 · 登录页改版',
    reviewKindLabel: '任务验收',
    slotLabel: 'product · 产品角色',
    version: 3,
    artifacts: [{ label: '实现 · 后端实现', detail: 'text/x-source · 校验 2/2' }],
    checks: { passed: 2, total: 2 },
    codeRefs: 1,
    comment: '检查通过，同意验收。',
    impact: '该槽位记为验收通过；若全部槽位通过，任务进入已完成状态。',
  };

  it('密码确认前展示最终业务决定，技术摘要默认折叠', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: preview }));

    render(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        summary={summary}
        submitLabel="提交决定"
        onClose={() => undefined}
        onConfirmed={vi.fn()}
      />,
    );

    expect(await screen.findByText('即将提交的决定')).toBeInTheDocument();
    expect(screen.getByText('DEMO-REQ-1 · 登录页改版')).toBeInTheDocument();
    expect(screen.getByText('任务验收')).toBeInTheDocument();
    expect(screen.getByText('v3（与提交版本一致）')).toBeInTheDocument();
    expect(screen.getByText('检查通过，同意验收。')).toBeInTheDocument();
    expect(screen.getByText(/任务进入已完成状态/)).toBeInTheDocument();

    const technical = screen.getByText('查看技术详情').closest('details');
    expect(technical).not.toBeNull();
    expect(technical?.open).toBe(false);
    // 技术摘要仍保留，只是默认折叠。
    expect(screen.getByTestId('action-digest')).toHaveTextContent('digest-a');

    // 密码输入附近必须说明确认后会提交上述决定。
    expect(screen.getByText(/确认后会提交上述决定/)).toBeInTheDocument();
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument();
  });

  it('summary 变化时确认摘要实时更新', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: preview }));

    const { rerender } = render(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        summary={summary}
        onClose={() => undefined}
        onConfirmed={vi.fn()}
      />,
    );

    expect(await screen.findByText('检查通过，同意验收。')).toBeInTheDocument();

    rerender(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        summary={{ ...summary, decision: 'REJECT', comment: '证据不足，驳回。' }}
        onClose={() => undefined}
        onConfirmed={vi.fn()}
      />,
    );

    expect(screen.getByText('证据不足，驳回。')).toBeInTheDocument();
    expect(screen.getByText('驳回', { selector: '.wm-decision-badge' })).toBeInTheDocument();
  });
});

describe('ConfirmationPrompt（加载与提交中的反馈）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('关闭后以同一绑定重开，旧预览不能覆盖新会话', async () => {
    let finishOld: (value: unknown) => void = () => undefined;
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce(json(200, { data: { ...preview, actionDigest: 'new-digest' } }));
    const props = { title: '确认评审决定', binding, onClose: vi.fn(), onConfirmed: vi.fn() };
    const { rerender } = render(<ConfirmationPrompt {...props} open />);
    rerender(<ConfirmationPrompt {...props} open={false} />);
    rerender(<ConfirmationPrompt {...props} open />);
    expect(await screen.findByTestId('action-digest')).toHaveTextContent('new-digest');
    await act(async () => finishOld(json(200, { data: preview })));
    expect(screen.getByTestId('action-digest')).toHaveTextContent('new-digest');
    expect(screen.getByLabelText('确认密码')).toHaveValue('');
  });

  it.each(['成功', '失败'])('旧执行迟到%s不会关闭新会话或改变其忙状态', async (outcome) => {
    const ticketResponse = json(201, {
      data: {
        ticketId: 't1',
        ticketSecret: 's1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        actionDigest: 'digest-a',
      },
    });
    let finishB: (value: unknown) => void = () => undefined;
    fetchMock
      .mockResolvedValueOnce(json(200, { data: preview }))
      .mockResolvedValueOnce(ticketResponse)
      .mockResolvedValueOnce(json(200, { data: preview }))
      .mockReturnValueOnce(new Promise((resolve) => (finishB = resolve)));
    let finishA: () => void = () => undefined;
    let failA: (reason: Error) => void = () => undefined;
    const onConfirmed = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finishA = resolve;
          failA = reject;
        }),
    );
    const onClose = vi.fn();
    const props = { title: '确认评审决定', binding, onClose, onConfirmed };
    const { rerender } = render(<ConfirmationPrompt {...props} open />);
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-a' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
    rerender(<ConfirmationPrompt {...props} open={false} />);
    rerender(<ConfirmationPrompt {...props} open />);
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-b' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    await act(async () => {
      if (outcome === '成功') finishA();
      else failA(new Error('旧执行失败'));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/旧执行失败/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '校验中…' })).toBeDisabled();
    await act(async () => finishB(ticketResponse));
    expect(await screen.findByText(/票据已签发/)).toBeInTheDocument();
  });

  it('动作预览读取中显示 role="status" 加载态，签发按钮禁用且不能先输密码', async () => {
    let releasePreview: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePreview = resolve;
      }),
    );

    render(
      <ConfirmationPrompt
        open
        title="确认评审决定"
        binding={binding}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '确认评审决定' });
    const loadingRegion = within(dialog).getByRole('status');
    expect(loadingRegion).toHaveTextContent('正在读取服务端动作预览…');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: '读取动作预览中…' })).toBeDisabled();
    expect(within(dialog).queryByLabelText('确认密码')).not.toBeInTheDocument();

    await act(async () => {
      releasePreview(json(200, { data: preview }));
    });

    expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-a');
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    // 预览就绪后仍需先输入密码才能签发票据。
    expect(within(dialog).getByRole('button', { name: '验证密码并签发票据' })).toBeDisabled();
  });

  it('执行提交中：按钮显示忙文案并禁用，Esc 不会关闭弹窗', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: preview })).mockResolvedValueOnce(
      json(201, {
        data: {
          ticketId: 't1',
          ticketSecret: 's1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          actionDigest: 'digest-a',
        },
      }),
    );

    let releaseSubmit: () => void = () => undefined;
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const onConfirmed = vi.fn(async () => {
      await submitGate;
    });
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
    await screen.findByText(/票据已签发/);

    fireEvent.click(screen.getByRole('button', { name: '提交决定' }));

    const busyButton = screen.getByRole('button', { name: '提交中…' });
    expect(busyButton).toBeDisabled();
    const dialog = screen.getByRole('dialog', { name: '确认评审决定' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      releaseSubmit();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
