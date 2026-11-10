import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { ReviewDecisionDrawer } from './ReviewDecisionDrawer';

const reviewModule = vi.hoisted(() => {
  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    load: vi.fn(),
    render: vi.fn(),
    ready,
    resolve: () => resolveReady(),
  };
});

vi.mock('../pages/ReviewDecision', async () => {
  reviewModule.load();
  await reviewModule.ready;
  return {
    ReviewDecision: (props: {
      reviewId: string;
      embedded?: boolean;
      onDecisionCommitted?: () => void;
    }) => {
      reviewModule.render(props);
      if (props.reviewId === 'broken-review') throw new Error('Review rendering failed');
      return (
        <div>
          <p>评审 {props.reviewId}</p>
          <button onClick={props.onDecisionCommitted}>提交决定</button>
        </div>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function DrawerHarness({ onDecisionCommitted }: { onDecisionCommitted: () => void }) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setReviewId('review-one')}>打开评审</button>
      <ReviewDecisionDrawer
        reviewId={reviewId}
        onClose={() => setReviewId(null)}
        onDecisionCommitted={onDecisionCommitted}
      />
    </>
  );
}

it('关闭时不加载评审模块，加载期间仍可关闭并归还焦点，重新打开后提交回调保持有效', async () => {
  const onDecisionCommitted = vi.fn();
  render(<DrawerHarness onDecisionCommitted={onDecisionCommitted} />);
  const opener = screen.getByRole('button', { name: '打开评审' });
  opener.focus();

  expect(reviewModule.load).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: '评审决定' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('正在加载评审…');
  expect(screen.getByRole('button', { name: '关闭弹窗' })).toHaveFocus();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();

  await act(async () => {
    reviewModule.resolve();
    await reviewModule.ready;
  });
  expect(reviewModule.load).toHaveBeenCalledTimes(1);
  expect(reviewModule.render).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(opener);
  expect(await screen.findByText('评审 review-one')).toBeInTheDocument();
  expect(reviewModule.render).toHaveBeenLastCalledWith({
    reviewId: 'review-one',
    embedded: true,
    onDecisionCommitted,
  });
  fireEvent.click(screen.getByRole('button', { name: '提交决定' }));
  expect(onDecisionCommitted).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it('评审渲染失败仍交给已有页面错误边界处理', async () => {
  reviewModule.resolve();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const ignoreExpectedError = (event: ErrorEvent) => {
    if (event.error?.message === 'Review rendering failed') event.preventDefault();
  };
  window.addEventListener('error', ignoreExpectedError);
  try {
    render(
      <ErrorBoundary>
        <ReviewDecisionDrawer reviewId="broken-review" onClose={vi.fn()} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText('页面渲染出错')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试渲染' })).toBeInTheDocument();
  } finally {
    window.removeEventListener('error', ignoreExpectedError);
  }
});
