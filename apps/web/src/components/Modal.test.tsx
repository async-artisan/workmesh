import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(() => {
  cleanup();
});

interface NestedModalsProps {
  outerOnClose: () => void;
  innerOnClose: () => void;
  /** 初始时内层是否已经打开；默认两层同时打开以模拟抽屉 + 确认框。 */
  initialInnerOpen?: boolean;
}

/** 模拟真实用法：外层抽屉（variant="drawer"）里再开一个确认弹窗。 */
function NestedModals({ outerOnClose, innerOnClose, initialInnerOpen = true }: NestedModalsProps) {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(initialInnerOpen);

  return (
    <>
      <Modal
        open={outerOpen}
        title="外层抽屉"
        variant="drawer"
        onClose={() => {
          outerOnClose();
          setOuterOpen(false);
        }}
      >
        <p>签字说明（用户已填写，不能被误关丢失）</p>
        {!innerOpen && <button onClick={() => setInnerOpen(true)}>打开确认框</button>}
      </Modal>
      <Modal
        open={innerOpen}
        title="内层确认"
        onClose={() => {
          innerOnClose();
          setInnerOpen(false);
        }}
      >
        <p>一次性票据确认</p>
        <button>确认</button>
      </Modal>
    </>
  );
}

function FocusReturnHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开弹窗</button>
      <Modal open={open} title="焦点归还" onClose={() => setOpen(false)}>
        <button>卡片内按钮</button>
      </Modal>
    </>
  );
}

describe('Modal（Esc / 图层栈 / IME / 焦点）', () => {
  it('单层弹窗按 Esc 会调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="单层" onClose={onClose}>
        <button>确定</button>
      </Modal>,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('嵌套两层时按 Esc 只关闭栈顶那层，外层 onClose 不被调用', () => {
    const outerOnClose = vi.fn();
    const innerOnClose = vi.fn();
    render(<NestedModals outerOnClose={outerOnClose} innerOnClose={innerOnClose} />);

    expect(screen.getByRole('dialog', { name: '外层抽屉' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '内层确认' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(innerOnClose).toHaveBeenCalledTimes(1);
    expect(outerOnClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '内层确认' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '外层抽屉' })).toBeInTheDocument();
    expect(screen.getByText('签字说明（用户已填写，不能被误关丢失）')).toBeInTheDocument();
  });

  it('栈顶关闭后再按 Esc，由下一层接管并关闭剩下的那层', () => {
    const outerOnClose = vi.fn();
    const innerOnClose = vi.fn();
    render(<NestedModals outerOnClose={outerOnClose} innerOnClose={innerOnClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerOnClose).toHaveBeenCalledTimes(1);
    expect(outerOnClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(outerOnClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '外层抽屉' })).not.toBeInTheDocument();
  });

  it('栈顶关闭后重新打开时仍按栈顶处理，只关闭自己', () => {
    const outerOnClose = vi.fn();
    const innerOnClose = vi.fn();
    render(
      <NestedModals
        outerOnClose={outerOnClose}
        innerOnClose={innerOnClose}
        initialInnerOpen={false}
      />,
    );

    expect(screen.queryByRole('dialog', { name: '内层确认' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开确认框' }));
    expect(screen.getByRole('dialog', { name: '内层确认' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(innerOnClose).toHaveBeenCalledTimes(1);
    expect(outerOnClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '外层抽屉' })).toBeInTheDocument();
  });

  it('IME 组词中的 Esc 不关闭弹窗', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="输入法" onClose={onClose}>
        <textarea aria-label="签字说明" />
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();

    // 旧输入法只上报 keyCode 229 的情况同样要放行。
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, 'keyCode', { value: 229 });
    document.dispatchEvent(composing);
    expect(onClose).not.toHaveBeenCalled();

    // 组词结束后同一次 Esc 仍应正常关闭。
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('非 Esc 按键不影响弹窗', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="普通按键" onClose={onClose}>
        <input aria-label="标题" />
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'ArrowDown', isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('关闭后焦点归还到打开前的元素', () => {
    render(<FocusReturnHarness />);

    const opener = screen.getByRole('button', { name: '打开弹窗' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: '焦点归还' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '焦点归还' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('标题与描述分别通过 aria-labelledby / aria-describedby 关联', () => {
    render(
      <Modal open title="归档项目" description="归档后成员只能只读访问。" onClose={() => {}}>
        <p>影响说明</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: '归档项目' });
    expect(dialog).toHaveAccessibleDescription('归档后成员只能只读访问。');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('归档后成员只能只读访问。');
  });

  it('初始焦点优先落在第一个可编辑控件', () => {
    render(
      <Modal open title="新建项目" onClose={() => {}}>
        <input aria-label="项目名称" />
        <input aria-label="项目 Key" />
        <button>提交</button>
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '项目名称' }));
  });

  it('busy 时锁定关闭入口：Esc / 遮罩 / 关闭按钮都不关闭，卡片标记 aria-busy', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="正在提交" busy onClose={onClose}>
        <button>确认</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: '正在提交' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    const closeButton = screen.getByRole('button', { name: '关闭弹窗' });
    expect(closeButton).toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    fireEvent.click(closeButton);

    expect(onClose).not.toHaveBeenCalled();
  });
});
