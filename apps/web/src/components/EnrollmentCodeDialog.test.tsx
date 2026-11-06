import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollmentCodeDialog } from './EnrollmentCodeDialog';
import { setCsrfToken } from '../api/client';
import { envelope, methodOf, mockFetch, pathOf } from '../test-utils';
import type { WorkspaceEnrollmentView } from '../api/resources';

const issued: WorkspaceEnrollmentView = {
  enrollmentId: 'enr-1',
  code: 'wm-enroll-once',
  projectId: 'p1',
  definitionRevisionId: 'rev-1',
  definitionDigest: 'd'.repeat(64),
  expiresAt: '2026-11-06T00:00:00.000Z',
};

function renderDialog(onClose = () => undefined) {
  return render(<EnrollmentCodeDialog open projectId="p1" onClose={onClose} />);
}

function ClosableDialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>重新打开接入码弹窗</button>
      <EnrollmentCodeDialog open={open} projectId="p1" onClose={() => setOpen(false)} />
    </>
  );
}

describe('EnrollmentCodeDialog（加载反馈）', () => {
  beforeEach(() => setCsrfToken('csrf-1'));
  afterEach(() => setCsrfToken(null));

  it('签发中显示 role="status"、禁用生成按钮但允许关闭，完成后只展示一次明文码', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const issueReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));

    const loadingRegion = await screen.findByRole('status');
    expect(loadingRegion).toHaveTextContent('正在生成一次性接入码…');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();

    await act(async () => {
      release({ status: 201, body: envelope(issued) });
    });

    const code = (await screen.findByLabelText('一次性接入码')) as HTMLInputElement;
    expect(code.value).toBe('wm-enroll-once');
    expect(screen.getByRole('button', { name: '复制接入码' })).toBeEnabled();
    expect(screen.queryByText('正在生成一次性接入码…')).not.toBeInTheDocument();
  });

  it('已签发后关闭按钮可用', async () => {
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return { status: 201, body: envelope(issued) };
      return undefined;
    });
    const onClose = vi.fn();

    renderDialog(onClose);
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByLabelText('一次性接入码')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('项目切换后忽略旧项目迟到的签发响应', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const issueReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    const view = render(<EnrollmentCodeDialog open projectId="p1" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByText('正在生成一次性接入码…')).toBeInTheDocument();

    view.rerender(<EnrollmentCodeDialog open projectId="p2" onClose={() => undefined} />);
    await act(async () => {
      release({
        status: 201,
        body: envelope({ ...issued, code: 'OLD-PROJECT-CODE', projectId: 'p1' }),
      });
    });

    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
    expect(screen.queryByText('OLD-PROJECT-CODE')).not.toBeInTheDocument();
    expect(screen.queryByText('p1')).not.toBeInTheDocument();
  });

  it('签发中关闭并重开时忽略迟到响应且不恢复旧提示', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const issueReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    render(<ClosableDialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByText('正在生成一次性接入码…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新打开接入码弹窗' }));
    await act(async () => {
      release({ status: 201, body: envelope({ ...issued, code: 'CLOSED-DIALOG-CODE' }) });
    });

    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
    expect(screen.queryByText('CLOSED-DIALOG-CODE')).not.toBeInTheDocument();
    expect(screen.queryByText(/已复制|复制失败/)).not.toBeInTheDocument();
  });

  it('签发中关闭并重开时忽略迟到失败，不把旧项目错误带回弹窗', async () => {
    let reject: (error: Error) => void = () => undefined;
    const issueReply = new Promise<{ status: number; body: unknown }>((_resolve, onReject) => {
      reject = onReject;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    render(<ClosableDialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByText('正在生成一次性接入码…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新打开接入码弹窗' }));
    await act(async () => {
      reject(new Error('late enrollment failure'));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('late enrollment failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeEnabled();
  });
});
