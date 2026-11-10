import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbenchChangeItem } from '../api/resources';
import { Modal } from './Modal';
import { DeferredBatchReviewApprove, DeferredChangeDrawer } from './WorkbenchDialogs';

const imports = vi.hoisted(() => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  return {
    changeLoad: vi.fn(),
    batchLoad: vi.fn(),
    changeReady: deferred(),
    batchReady: deferred(),
  };
});

vi.mock('./ChangeDrawer', async () => {
  imports.changeLoad();
  if (imports.changeLoad.mock.calls.length === 1) throw new Error('chunk unavailable');
  await imports.changeReady.promise;
  return {
    ChangeDrawer: ({
      change,
      busy,
      onClose,
      onAck,
    }: {
      change: WorkbenchChangeItem | null;
      busy: boolean;
      onClose: () => void;
      onAck: () => void;
    }) => (
      <Modal open={Boolean(change)} title="需求变更 · 需要确认" busy={busy} onClose={onClose}>
        <label>
          变更说明
          <input />
        </label>
        <button onClick={onAck} disabled={busy}>
          确认已知悉
        </button>
      </Modal>
    ),
  };
});

vi.mock('./BatchReviewApprove', async () => {
  imports.batchLoad();
  await imports.batchReady.promise;
  return {
    BatchReviewApprove: ({ open, onClose }: { open: boolean; onClose: () => void }) => {
      const [password, setPassword] = useState('');
      return (
        <Modal open={open} title="批量批准" onClose={onClose}>
          <label>
            登录密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </Modal>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ChangeHarness({ onAck }: { onAck: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p>保留的工作台待办</p>
      <button onClick={() => setOpen(true)}>查看变更</button>
      <DeferredChangeDrawer
        change={open ? ({ recipientId: 'recipient-1', version: 2 } as WorkbenchChangeItem) : null}
        busy={busy}
        error=""
        onClose={() => setOpen(false)}
        onAck={() => {
          setBusy(true);
          onAck();
        }}
      />
    </>
  );
}

it('变更模块仅在打开后请求；加载失败能在局部重试，成功交接焦点并保留提交锁', async () => {
  const onAck = vi.fn();
  render(<ChangeHarness onAck={onAck} />);
  const opener = screen.getByRole('button', { name: '查看变更' });
  opener.focus();
  expect(imports.changeLoad).not.toHaveBeenCalled();

  fireEvent.click(opener);
  expect(screen.getByRole('status')).toHaveTextContent('正在加载需求变更');
  expect(await screen.findByRole('alert')).toHaveTextContent('无法加载此窗口');
  expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('先保存其他未提交输入');
  expect(screen.getByText('保留的工作台待办')).toBeInTheDocument();
  expect(onAck).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
  await waitFor(() => expect(imports.changeLoad).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('status')).toHaveTextContent('正在加载需求变更');
  await act(async () => {
    imports.changeReady.resolve();
    await imports.changeReady.promise;
  });
  const input = await screen.findByLabelText('变更说明');
  expect(input).toHaveFocus();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();

  fireEvent.click(opener);
  expect(await screen.findByLabelText('变更说明')).toHaveFocus();
  expect(imports.changeLoad).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '确认已知悉' }));
  expect(onAck).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '关闭弹窗' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

function BatchHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开批量批准</button>
      <DeferredBatchReviewApprove
        open={open}
        targets={[]}
        onClose={() => setOpen(false)}
        onCompleted={() => {}}
      />
    </>
  );
}

it('批量模块关闭时不请求；加载中可关闭且晚到结果不重开，关闭后清空密码', async () => {
  render(<BatchHarness />);
  const opener = screen.getByRole('button', { name: '打开批量批准' });
  opener.focus();
  expect(imports.batchLoad).not.toHaveBeenCalled();

  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: '批量批准' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '关闭弹窗' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();

  await act(async () => {
    imports.batchReady.resolve();
    await imports.batchReady.promise;
  });
  expect(imports.batchLoad).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(opener);
  const password = await screen.findByLabelText('登录密码');
  expect(password).toHaveFocus();
  fireEvent.change(password, { target: { value: 'sensitive-value' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  expect(await screen.findByLabelText('登录密码')).toHaveValue('');
  expect(imports.batchLoad).toHaveBeenCalledTimes(1);
});
