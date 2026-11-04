import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { useToastStore, toast } from '../store/toast';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { PageState, toPageLoadState } from './PageState';
import { StaleDataBanner } from './StaleDataBanner';
import { ToastHost } from './ToastHost';

/** toast store 会在 3600ms 后自动清理；测试之间手动清空，避免跨用例污染。 */
afterEach(() => {
  act(() => {
    useToastStore.setState({ items: [] });
  });
});

describe('EmptyState（四种空态语义）', () => {
  it('no-data：提供创建入口，点击主操作触发回调', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        variant="no-data"
        title="还没有项目"
        description="当前空间还没有项目。可以创建第一个项目，或通过邀请加入已有项目。"
        actionLabel="创建项目"
        onAction={onAction}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('还没有项目');
    expect(status).toHaveAccessibleDescription(
      '当前空间还没有项目。可以创建第一个项目，或通过邀请加入已有项目。',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const createButton = within(status).getByRole('button', { name: '创建项目' });
    fireEvent.click(createButton);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('no-access：说明需要联系管理员开通权限，且没有操作入口时给出等待说明', () => {
    render(
      <EmptyState
        variant="no-access"
        title="没有访问权限"
        description="当前账号没有访问该空间的权限。"
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('当前账号没有访问该空间的权限。');
    expect(status).toHaveTextContent('权限开通后，重新加载页面即可访问。');
    expect(within(status).queryAllByRole('button')).toHaveLength(0);
  });

  it('no-match：提示调整筛选条件，而不是让用户以为没有数据', () => {
    render(
      <EmptyState
        variant="no-match"
        title="没有匹配的结果"
        description="当前筛选条件下没有匹配的项目。"
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('当前筛选条件下没有匹配的项目。');
    expect(status).toHaveTextContent('可以调整或清除筛选条件后重试。');
    expect(within(status).queryAllByRole('button')).toHaveLength(0);
  });

  it('waiting：没有操作入口时说明在等待什么', () => {
    render(
      <EmptyState variant="waiting" title="等待处理结果" description="系统正在生成评审结果。" />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('系统正在生成评审结果。');
    expect(status).toHaveTextContent('等待数据处理完成或他人完成操作后，这里会自动更新。');
    expect(within(status).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('ErrorState（页面错误可访问性）', () => {
  it('role=alert、说明可被屏幕阅读器读取，重试为原生 button 且有中文可访问名称', () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="项目加载失败"
        message="暂时无法加载项目数据，请稍后重试。"
        detail="[INTERNAL_ERROR] 服务端异常"
        requestId="req-a11y"
        onRetry={onRetry}
        retryAriaLabel="重新加载项目"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAccessibleName('项目加载失败');
    expect(alert).toHaveAccessibleDescription('暂时无法加载项目数据，请稍后重试。');

    // aria-labelledby / aria-describedby 必须指向真实存在的元素。
    const labelledBy = alert.getAttribute('aria-labelledby');
    const describedBy = alert.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    const titleElement = document.getElementById(labelledBy ?? '');
    const descriptionElement = document.getElementById(describedBy ?? '');
    expect(titleElement).not.toBeNull();
    expect(descriptionElement).not.toBeNull();
    if (!titleElement || !descriptionElement) throw new Error('aria 关联元素不存在');
    expect(titleElement).toHaveTextContent('项目加载失败');
    expect(descriptionElement).toHaveTextContent('暂时无法加载项目数据，请稍后重试。');

    const retryButton = within(alert).getByRole('button', { name: '重新加载项目' });
    expect(retryButton.tagName).toBe('BUTTON');
    expect(retryButton).toHaveAttribute('type', 'button');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // requestId 默认收在“查看详细信息”里，展开后可见。
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    if (!details) throw new Error('错误状态应包含技术信息折叠区域');
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('requestId: req-a11y');
    fireEvent.click(within(details).getByText('查看详细信息'));
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent('requestId: req-a11y');
  });
});

describe('Toast 与页面错误 / 过期提示的语义边界', () => {
  it('Toast 不替代页面错误：页面错误仍在 role=alert，Toast 只是独立的 role=status', () => {
    render(
      <>
        <ToastHost />
        <PageState
          state={{ kind: 'error', message: '项目加载失败，请稍后重试。' }}
          onRetry={vi.fn()}
        />
      </>,
    );

    act(() => {
      toast.error('请求失败，请检查网络');
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('项目加载失败，请稍后重试。');
    expect(alert).not.toHaveTextContent('请求失败，请检查网络');

    const toastRegion = screen.getByRole('status');
    expect(toastRegion).toHaveTextContent('请求失败，请检查网络');
    expect(within(toastRegion).getByRole('button', { name: '关闭提示' })).toBeInTheDocument();

    // Toast 可以消失，但页面级错误必须仍然可见。
    fireEvent.click(within(toastRegion).getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('项目加载失败，请稍后重试。');
  });

  it('过期提示不会误显示为正常同步：包含“可能已经过期”，不出现“已同步/数据最新/同步成功”', () => {
    const onRetry = vi.fn();
    render(
      <StaleDataBanner
        updatedAt={new Date(2026, 10, 4, 7, 56)}
        message="本次更新失败，数据可能已经过期。"
        onRetry={onRetry}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('当前显示的是上次成功数据 · 07:56');
    expect(status).toHaveTextContent('可能已经过期');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/已同步|数据最新|同步成功/)).not.toBeInTheDocument();

    const retryButton = within(status).getByRole('button', { name: '重试更新数据' });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('toPageLoadState（错误映射）', () => {
  it('403 映射为 forbidden，普通 Error 映射为 error 且保留 detail', () => {
    const forbiddenState = toPageLoadState(
      new ApiError(403, 'FORBIDDEN', '无权限访问', undefined, 'req-403'),
    );
    expect(forbiddenState.kind).toBe('forbidden');
    if (forbiddenState.kind !== 'forbidden') throw new Error('403 应映射为 forbidden');
    expect(forbiddenState.message).toBe(
      '当前账号没有访问该内容的权限。如需访问，请联系项目管理员。',
    );

    const errorState = toPageLoadState(new Error('网络连接中断'));
    expect(errorState.kind).toBe('error');
    if (errorState.kind !== 'error') throw new Error('普通错误应映射为 error');
    expect(errorState.message).toBe('暂时无法加载数据，请稍后重试。');
    expect(errorState.detail).toBe('网络连接中断');
    expect(errorState.requestId).toBeUndefined();

    // 非 403 的 ApiError 仍保留 requestId，供“查看详细信息”核对审计。
    const apiErrorState = toPageLoadState(
      new ApiError(500, 'INTERNAL_ERROR', '服务端异常', undefined, 'req-500'),
    );
    expect(apiErrorState.kind).toBe('error');
    if (apiErrorState.kind !== 'error') throw new Error('500 应映射为 error');
    expect(apiErrorState.requestId).toBe('req-500');
    expect(apiErrorState.detail).toBe('[INTERNAL_ERROR] 服务端异常 · requestId req-500');
  });
});
