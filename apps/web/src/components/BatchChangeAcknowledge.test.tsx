import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { changeApi } from '../api/resources';
import { BatchChangeAcknowledge, type BatchChangeTarget } from './BatchChangeAcknowledge';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const targets: BatchChangeTarget[] = [
  { recipientId: 'c1', label: '需求一', version: 2 },
  { recipientId: 'c2', label: '需求二', version: 2 },
  { recipientId: 'c3', label: '需求三', version: 2 },
];

function props() {
  return {
    open: true,
    targets,
    getCurrentTargets: () => targets,
    onAcknowledged: vi.fn(),
    refresh: vi.fn(async () => true),
    onCompleted: vi.fn(),
    onBusyChange: vi.fn(),
    onClose: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('严格逐项提交并同步防重；首错停止，重试采用最新版本且只标记当前处理行', async () => {
  const first = deferred();
  const retried = deferred();
  const ack = vi
    .spyOn(changeApi, 'ack')
    .mockImplementationOnce(() => first.promise)
    .mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', '收件人版本已变化'))
    .mockImplementationOnce(() => retried.promise);
  const callbacks = props();
  let currentTargets = targets;
  callbacks.getCurrentTargets = () => currentTargets;
  callbacks.refresh.mockImplementation(async () => {
    currentTargets = [targets[0], { ...targets[1], version: 3 }];
    return true;
  });
  render(<BatchChangeAcknowledge {...callbacks} />);

  const start = screen.getByRole('button', { name: '确认开始' });
  act(() => {
    start.click();
    start.click();
  });
  expect(ack.mock.calls).toEqual([['c1', 2]]);
  expect(screen.getByRole('button', { name: '关闭弹窗' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.mouseDown(screen.getByRole('presentation'));
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(screen.getByText('正在处理 1 / 3')).toBeInTheDocument();
  expect(callbacks.refresh).not.toHaveBeenCalled();

  await act(async () => first.resolve());
  await screen.findByText('已确认 1 条 · 失败 1 条 · 未处理 1 条');
  await waitFor(() => expect(screen.getByRole('button', { name: '关闭弹窗' })).toBeEnabled());
  expect(ack.mock.calls).toEqual([
    ['c1', 2],
    ['c2', 2],
  ]);
  expect(callbacks.onAcknowledged.mock.calls).toEqual([['c1']]);
  expect(callbacks.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/数据已变化，请重新加载/)).toHaveTextContent('VERSION_CONFLICT');
  expect(screen.getByText(/需求三/).closest('li')).toHaveTextContent('已不在当前列表中');

  fireEvent.click(screen.getByRole('button', { name: '重试失败项（1）' }));
  expect(ack.mock.calls).toEqual([
    ['c1', 2],
    ['c2', 2],
    ['c2', 3],
  ]);
  const resultList = screen.getByRole('list', { name: '批量确认结果' });
  expect(within(resultList).getByText('需求一').closest('li')).toHaveTextContent('已确认');
  expect(within(resultList).getByText('需求二').closest('li')).toHaveTextContent('v3 · 处理中…');
  expect(screen.getByText('正在处理 1 / 1')).toBeInTheDocument();
  await act(async () => retried.resolve());
  await screen.findByText('已确认 2 条 · 失败 0 条 · 未处理 0 条');
  await waitFor(() =>
    expect(callbacks.onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]),
  );
  expect(callbacks.onAcknowledged.mock.calls).toEqual([['c1'], ['c2']]);
  expect(callbacks.onCompleted.mock.calls).toEqual([[1], [1]]);
  expect(ack).toHaveBeenCalledTimes(3);
});

it.each(['success', 'failure'] as const)(
  '卸载后第一项 %s 不发送下一项或回调已经离开的页面',
  async (outcome) => {
    const pending = deferred();
    const ack = vi.spyOn(changeApi, 'ack').mockImplementation(() => pending.promise);
    const callbacks = props();
    const view = render(<BatchChangeAcknowledge {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '确认开始' }));
    view.unmount();
    await act(async () => {
      if (outcome === 'success') pending.resolve();
      else pending.reject(new Error('late failure'));
    });
    expect(ack.mock.calls).toEqual([['c1', 2]]);
    expect(callbacks.onAcknowledged).not.toHaveBeenCalled();
    expect(callbacks.refresh).not.toHaveBeenCalled();
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(callbacks.onBusyChange.mock.calls).toEqual([[true]]);
  },
);

it.each(['success', 'failure'] as const)(
  '卸载后刷新 %s 不报告完成或解锁已经离开的页面',
  async (outcome) => {
    const pending = deferred();
    vi.spyOn(changeApi, 'ack').mockResolvedValue(undefined);
    const callbacks = props();
    callbacks.targets = [targets[0]];
    callbacks.refresh.mockImplementation(async () => {
      await pending.promise;
      return true;
    });
    const view = render(<BatchChangeAcknowledge {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '确认开始' }));
    await waitFor(() => expect(callbacks.refresh).toHaveBeenCalledTimes(1));
    expect(callbacks.onAcknowledged).toHaveBeenCalledWith('c1');
    view.unmount();
    await act(async () => {
      if (outcome === 'success') pending.resolve();
      else pending.reject(new Error('late refresh failure'));
    });
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(callbacks.onBusyChange.mock.calls).toEqual([[true]]);
  },
);
