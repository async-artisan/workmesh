import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollmentCodeDialog } from './EnrollmentCodeDialog';
import { setCsrfToken } from '../api/client';
import { envelope, methodOf, mockFetch, pathOf, type StubHandler } from '../test-utils';
import type { WorkspaceEnrollmentView } from '../api/resources';
import { useAuthStore } from '../store/auth';

const issued: WorkspaceEnrollmentView = {
  enrollmentId: 'enr-1',
  code: 'wm-enroll-once',
  projectId: 'p1',
  definitionRevisionId: 'rev-1',
  definitionDigest: 'd'.repeat(64),
  expiresAt: '2026-11-06T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().clearAuth();
});

function issueCodeOnly() {
  fireEvent.click(screen.getByLabelText('我已有本机命令参数，仅生成接入码'));
  fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
}

function renderDialog(onClose = () => undefined) {
  return render(<EnrollmentCodeDialog open projectId="p1" onClose={onClose} />);
}

function mockEnrollmentFetch(handler: StubHandler) {
  return mockFetch((url, init) => {
    if (pathOf(url) === '/api/v1/projects/p1/roles' && methodOf(init) === 'GET')
      return {
        status: 200,
        body: envelope([
          { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
          { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
          { id: 'r-disabled', projectId: 'p1', key: 'disabled', title: '已停用', isActive: false },
        ]),
      };
    if (pathOf(url) === '/api/v1/projects/p2/roles' && methodOf(init) === 'GET')
      return { status: 200, body: envelope([]) };
    return handler(url, init);
  });
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
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    renderDialog();
    issueCodeOnly();

    const loadingRegion = (await screen.findByText('正在生成一次性接入码…')).closest(
      '[role="status"]',
    );
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
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return { status: 201, body: envelope(issued) };
      return undefined;
    });
    const onClose = vi.fn();

    renderDialog(onClose);
    issueCodeOnly();
    expect(await screen.findByLabelText('一次性接入码')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('项目切换后忽略旧项目迟到的签发响应', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const issueReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    const view = render(<EnrollmentCodeDialog open projectId="p1" onClose={() => undefined} />);
    issueCodeOnly();
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
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    render(<ClosableDialogHarness />);
    issueCodeOnly();
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
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return issueReply;
      return undefined;
    });

    render(<ClosableDialogHarness />);
    issueCodeOnly();
    expect(await screen.findByText('正在生成一次性接入码…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新打开接入码弹窗' }));
    await act(async () => {
      reject(new Error('late enrollment failure'));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('late enrollment failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeDisabled();
  });
});

describe('EnrollmentCodeDialog（接入预览命令）', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn<(value: string) => Promise<void>>();

  beforeEach(() => {
    setCsrfToken('csrf-1');
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return { status: 201, body: envelope(issued) };
      return undefined;
    });
  });

  afterEach(() => {
    setCsrfToken(null);
    vi.unstubAllEnvs();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  async function openIssued() {
    renderDialog();
    issueCodeOnly();
    await screen.findByLabelText('一次性接入码');
    await screen.findByRole('option', { name: '前端（frontend）' });
  }

  function configure() {
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'git-bash' } });
    fireEvent.change(screen.getByLabelText('Agent 客户端'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('项目角色'), { target: { value: 'frontend' } });
    fireEvent.change(screen.getByLabelText('本地工作区根目录'), {
      target: { value: 'G:\\Business Projects\\app' },
    });
    fireEvent.change(screen.getByLabelText('WorkMesh API 地址'), {
      target: { value: 'http://127.0.0.1:3000/api/v1' },
    });
  }

  it('参数在签发前可见，缺失或无效参数时不允许签发短时码', async () => {
    renderDialog();
    await screen.findByRole('option', { name: '前端（frontend）' });
    expect(screen.getByLabelText('本地工作区根目录')).toBeInTheDocument();
    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeDisabled();
    configure();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('WorkMesh API 地址'), {
      target: { value: 'https://example.com' },
    });
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('WorkMesh API 地址'), {
      target: { value: 'https://mesh.example.com/team/api/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    await screen.findByLabelText('一次性接入码');
    expect((screen.getByLabelText('CLI 预览命令') as HTMLTextAreaElement).value).toContain(
      'https://mesh.example.com/team/api/v1',
    );
  });

  it('记住终端和客户端，关闭即丢弃接入码、角色、目录和手填API', async () => {
    render(<ClosableDialogHarness />);
    await screen.findByRole('option', { name: '前端（frontend）' });
    configure();
    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    await screen.findByLabelText('一次性接入码');
    expect(JSON.stringify(localStorage)).not.toContain('wm-enroll-once');
    expect(JSON.stringify(localStorage)).not.toContain('Business Projects');
    expect(JSON.stringify(localStorage)).not.toContain('127.0.0.1');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '重新打开接入码弹窗' }));
    expect(screen.getByLabelText('Shell')).toHaveValue('git-bash');
    expect(screen.getByLabelText('Agent 客户端')).toHaveValue('codex');
    expect(screen.getByLabelText('项目角色')).toHaveValue('');
    expect(screen.getByLabelText('本地工作区根目录')).toHaveValue('');
    expect(screen.getByLabelText('WorkMesh API 地址')).toHaveValue('');
    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
  });

  it('公共API只采用部署配置，缺少配置不推断网页地址', async () => {
    vi.stubEnv('VITE_WORKMESH_PUBLIC_API_URL', 'https://public.example.com/prefix/api/v1');
    renderDialog();
    expect(screen.getByLabelText('WorkMesh API 地址')).toHaveValue(
      'https://public.example.com/prefix/api/v1',
    );
    expect(screen.getByText(/地址由部署管理员/)).toBeInTheDocument();
  });

  it('无效部署地址明确提示并保持空值，不生成含凭据或不安全地址的命令', () => {
    vi.stubEnv('VITE_WORKMESH_PUBLIC_API_URL', 'https://secret:password@public.example.com/api/v1');
    renderDialog();
    expect(screen.getByLabelText('WorkMesh API 地址')).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('部署提供的公共 API 地址无效');
    expect(screen.getByRole('alert')).not.toHaveTextContent('password');
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeDisabled();
  });

  it('只把当前成员已分配的活动业务角色作为可选授权角色', async () => {
    useAuthStore.getState().setSession({ id: 'u1', email: 'me@example.com' });
    mockEnrollmentFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/members')
        return {
          status: 200,
          body: envelope([
            {
              id: 'u1',
              email: 'me@example.com',
              role: 'ADMIN',
              version: 1,
              roles: [{ id: 'r-frontend', key: 'frontend', title: '前端' }],
            },
          ]),
        };
      if (pathOf(url) === '/api/v1/projects/p1/workspace-enrollments' && methodOf(init) === 'POST')
        return { status: 201, body: envelope(issued) };
      return undefined;
    });
    renderDialog();
    await screen.findByText(/你已分配的活动业务角色：前端/);
    expect(screen.getByLabelText('项目角色')).toHaveValue('frontend');
    expect(screen.getByRole('option', { name: '产品（product）' })).toBeDisabled();
    expect(screen.getByText(/项目管理员身份与业务角色分别管理/)).toBeInTheDocument();
  });

  it('不从 Web origin 猜 API，也不默认选角色；补齐字段后可复制预览', async () => {
    await openIssued();
    expect(screen.getByLabelText('WorkMesh API 地址')).toHaveValue('');
    expect(screen.getByLabelText('项目角色')).toHaveValue('');
    expect(screen.queryByRole('option', { name: '已停用（disabled）' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制预览命令' })).toBeDisabled();
    configure();
    const command = screen.getByLabelText('CLI 预览命令') as HTMLTextAreaElement;
    expect(command.value).toContain('workmesh workspace init --join');
    expect(command.value).toContain('/g/Business Projects/app');
    expect(command.value).toContain('frontend');
    expect(command.value).not.toContain('--apply');
    expect(command.value).not.toContain('--yes');
    expect(command.value).not.toMatch(/[\r\n]/);
    fireEvent.click(screen.getByRole('button', { name: '复制预览命令' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command.value));
    expect(await screen.findByText(/预览命令已复制/)).toBeInTheDocument();
    expect(screen.getByText(/workmesh workspace status/)).toBeInTheDocument();
  });

  it('切换角色和 Shell 后更新命令，不携带默认产品角色', async () => {
    await openIssued();
    configure();
    fireEvent.change(screen.getByLabelText('项目角色'), { target: { value: 'product' } });
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'powershell' } });
    const command = screen.getByLabelText('CLI 预览命令') as HTMLTextAreaElement;
    expect(command.value).toContain('product');
    expect(command.value).not.toContain('frontend');
    expect(command.value).toContain('G:');
    expect(command.value).not.toContain('/g/');
  });

  it('复制失败时明确提示手动复制，保留命令和一次性码', async () => {
    writeText.mockRejectedValue(new Error('clipboard denied'));
    await openIssued();
    configure();
    fireEvent.click(screen.getByRole('button', { name: '复制预览命令' }));
    expect(await screen.findByText('复制失败，请手动选中预览命令复制。')).toBeInTheDocument();
    expect(screen.getByLabelText('一次性接入码')).toHaveValue(issued.code);
    expect(screen.getByLabelText('CLI 预览命令')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制预览命令' })).toBeEnabled();
  });

  it('仍可仅复制接入码，缺少 API 时不能复制命令', async () => {
    await openIssued();
    fireEvent.click(screen.getByRole('button', { name: '复制接入码' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(issued.code));
    expect(await screen.findByText(/接入码已复制/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制预览命令' })).toBeDisabled();
  });
});
