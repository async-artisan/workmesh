import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeclareRepositoryDialog } from './DeclareRepositoryDialog';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

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
            action: 'REPOSITORY_DECLARE',
            targetType: 'PROJECT',
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
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          actionDigest: 'a'.repeat(64),
        }),
      };
    return undefined;
  };
}

function renderDialog() {
  const onDeclared = vi.fn().mockResolvedValue(undefined);
  render(
    <DeclareRepositoryDialog
      open
      projectId="p1"
      projectVersion={3}
      onClose={() => undefined}
      onDeclared={onDeclared}
    />,
  );
  return { onDeclared };
}

describe('DeclareRepositoryDialog（加载反馈）', () => {
  beforeEach(() => setCsrfToken('csrf-1'));
  afterEach(() => setCsrfToken(null));

  it('声明请求在飞时正文显示 role="status"，按钮「声明中…」禁用且不能重复提交', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const declareReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    const mock = mockFetch((url, init) => {
      if (
        pathOf(url) === '/api/v1/projects/p1/repositories/declarations' &&
        methodOf(init) === 'POST'
      )
        return declareReply;
      return handler()(url, init);
    });
    const { onDeclared } = renderDialog();

    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/demo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续（需要二次验证）' }));

    fireEvent.change(await screen.findByLabelText('确认密码'), {
      target: { value: 'Yff-Demo-2026!' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认声明仓库' }));

    const loadingRegion = await screen.findByRole('status');
    expect(loadingRegion).toHaveTextContent('正在声明仓库');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    const busyButton = screen.getByRole('button', { name: '声明中…' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByLabelText('仓库地址')).toBeDisabled();

    // 进行中再次点击不会产生第二个声明请求。
    fireEvent.click(busyButton);
    expect(
      mock.mock.calls.filter(
        ([url, init]) =>
          pathOf(String(url)) === '/api/v1/projects/p1/repositories/declarations' &&
          methodOf(init ?? {}) === 'POST',
      ),
    ).toHaveLength(1);

    await act(async () => {
      release({
        status: 201,
        body: envelope({
          repositoryId: 'repo-1',
          locatorId: 'loc-1',
          identityMode: 'DECLARED',
          canonicalLocator: 'https://github.com/acme/demo',
          source: 'HTTPS',
          owner: 'acme',
          name: 'demo',
          reused: false,
          replayed: false,
          alias: false,
          projectVersion: 4,
        }),
      });
    });

    expect(await screen.findByText(/仓库已声明/)).toBeInTheDocument();
    await waitFor(() => expect(onDeclared).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('正在声明仓库，等待服务端校验项目版本与票据…'),
    ).not.toBeInTheDocument();
  });
});

describe('DeclareRepositoryDialog（会话隔离）', () => {
  beforeEach(() => setCsrfToken('csrf-1'));
  afterEach(() => setCsrfToken(null));

  const declared = {
    repositoryId: 'repo-1',
    locatorId: 'loc-1',
    identityMode: 'PROVIDER',
    canonicalLocator: 'https://github.com/acme/demo',
    source: 'HTTPS',
    owner: 'acme',
    name: 'demo',
    reused: true,
    replayed: false,
    alias: false,
    projectVersion: 4,
  };

  async function enterConfirmation() {
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/demo' },
    });
    fireEvent.change(screen.getByLabelText('展示名（可选）'), { target: { value: '旧展示名' } });
    fireEvent.click(screen.getByRole('button', { name: '继续（需要二次验证）' }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'secret' } });
  }

  it('A 的迟到票据不会出现在切换后的 B，关闭重开会清空表单', async () => {
    let release!: (value: { status: number; body: unknown }) => void;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) =>
      pathOf(url) === '/api/v1/auth/confirmation-tickets' ? pending : handler()(url, init),
    );
    const onDeclared = vi.fn();
    const props = { open: true, projectId: 'p1', projectVersion: 3, onClose: vi.fn(), onDeclared };
    const view = render(<DeclareRepositoryDialog {...props} />);
    await enterConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    view.rerender(<DeclareRepositoryDialog {...props} projectId="p2" />);
    expect(screen.getByLabelText('仓库地址')).toHaveValue('');
    expect(screen.getByLabelText('展示名（可选）')).toHaveValue('');
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
    await act(async () =>
      release({
        status: 201,
        body: envelope({
          ticketId: 'old',
          ticketSecret: 'old-secret',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          actionDigest: 'a'.repeat(64),
        }),
      }),
    );
    expect(screen.queryByText(/票据已签发/)).not.toBeInTheDocument();
    expect(onDeclared).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://example.com/new' },
    });
    view.rerender(<DeclareRepositoryDialog {...props} projectId="p2" open={false} />);
    view.rerender(<DeclareRepositoryDialog {...props} projectId="p2" />);
    expect(screen.getByLabelText('仓库地址')).toHaveValue('');
    expect(screen.queryByText(/票据已签发/)).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'])('A 的迟到声明 %s 不会更新或刷新 B', async (outcome) => {
    let release!: (value: { status: number; body: unknown }) => void;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) =>
      pathOf(url).endsWith('/repositories/declarations') ? pending : handler()(url, init),
    );
    const onDeclared = vi.fn();
    const props = { open: true, projectId: 'p1', projectVersion: 3, onClose: vi.fn(), onDeclared };
    const view = render(<DeclareRepositoryDialog {...props} />);
    await enterConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认声明仓库' }));
    await screen.findByText(/正在声明仓库/);
    view.rerender(<DeclareRepositoryDialog {...props} projectId="p2" />);
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://example.com/b' },
    });
    await act(async () =>
      release(
        outcome === 'success'
          ? { status: 201, body: envelope(declared) }
          : {
              status: 409,
              body: { error: { code: 'PROJECT_VERSION_CONFLICT', message: 'old failure' } },
            },
      ),
    );
    expect(screen.getByLabelText('仓库地址')).toHaveValue('https://example.com/b');
    expect(screen.queryByText(/仓库已声明|项目版本已变化|old failure/)).not.toBeInTheDocument();
    expect(onDeclared).not.toHaveBeenCalled();
  });

  it('复用 PROVIDER 仓库时保留身份并说明本次未核验', async () => {
    mockFetch((url, init) =>
      pathOf(url).endsWith('/repositories/declarations')
        ? { status: 201, body: envelope(declared) }
        : handler()(url, init),
    );
    renderDialog();
    await enterConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认声明仓库' }));
    expect(await screen.findByText(/仓库已声明（PROVIDER）/)).toBeInTheDocument();
    expect(
      screen.getByText(/保留已有的 PROVIDER 身份；本次声明操作没有执行托管方核验/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/身份状态为“人工声明”/)).not.toBeInTheDocument();
  });
});
