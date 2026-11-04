import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageState } from './PageState';

/**
 * 页面加载状态组件的用户视角测试：
 * 每个 kind 都要给出可理解的文案、可访问性语义与正确的可操作入口，
 * 并且错误的技术细节默认折叠，不占据主界面。
 */
describe('PageState（页面加载状态统一组件）', () => {
  it('loading：以 role=status 播报“正在加载…”，并标记 aria-busy', () => {
    render(<PageState state={{ kind: 'loading' }} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('正在加载…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('empty：展示标题、说明与主操作按钮，点击主操作触发回调', () => {
    const onClick = vi.fn();
    render(
      <PageState
        state={{ kind: 'empty' }}
        title="还没有项目"
        description="当前空间还没有项目。可以创建第一个项目，或通过邀请加入已有项目。"
        action={{ label: '创建项目', onClick }}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('还没有项目');
    expect(status).toHaveTextContent(
      '当前空间还没有项目。可以创建第一个项目，或通过邀请加入已有项目。',
    );
    expect(within(status).queryByRole('alert')).not.toBeInTheDocument();

    const createButton = within(status).getByRole('button', { name: '创建项目' });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('error：展示可读中文说明与重试入口，技术细节默认折叠、展开后可见', () => {
    const onRetry = vi.fn();
    render(
      <PageState
        state={{
          kind: 'error',
          message: '暂时无法加载项目数据，请稍后重试。',
          detail: '[INTERNAL_ERROR] 服务端异常',
          requestId: 'req-page-1',
        }}
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('页面加载失败');
    expect(alert).toHaveTextContent('暂时无法加载项目数据，请稍后重试。');

    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    if (!details) throw new Error('错误状态应包含技术信息折叠区域');
    expect(details.open).toBe(false);

    fireEvent.click(within(details).getByText('查看详细信息'));
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent('[INTERNAL_ERROR] 服务端异常');
    expect(details).toHaveTextContent('requestId: req-page-1');

    const retryButton = within(alert).getByRole('button', { name: '重试' });
    expect(retryButton.tagName).toBe('BUTTON');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stale：显示上次成功时间 07:56 与“可能已经过期”，保留旧数据并支持重试', () => {
    const onRetry = vi.fn();
    const updatedAt = new Date(2026, 10, 4, 7, 56);
    render(
      <PageState
        state={{
          kind: 'stale',
          message: '本次更新失败，数据可能已经过期。',
          updatedAt: updatedAt.toISOString(),
        }}
        onRetry={onRetry}
      >
        <p>上次加载的项目列表（3 条）</p>
      </PageState>,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('当前显示的是上次成功数据 · 07:56');
    expect(status).toHaveTextContent('可能已经过期');

    // 旧数据仍然渲染，用户仍可阅读，不需要先重试。
    expect(screen.getByText('上次加载的项目列表（3 条）')).toBeInTheDocument();

    const retryButton = within(status).getByRole('button', { name: '重试更新数据' });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('forbidden：说明权限边界，未提供 onRetry 时不渲染重试入口', () => {
    render(
      <PageState
        state={{
          kind: 'forbidden',
          message: '当前账号没有访问该项目的权限。如需访问，请联系项目管理员。',
        }}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('没有访问权限');
    expect(status).toHaveTextContent('当前账号没有访问该项目的权限。如需访问，请联系项目管理员。');
    expect(status).toHaveTextContent('权限开通后，重新加载页面即可访问。');
    expect(within(status).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
  });
});
