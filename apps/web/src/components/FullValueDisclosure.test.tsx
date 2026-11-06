import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FullValueDisclosure } from './FullValueDisclosure';

describe('FullValueDisclosure', () => {
  it('默认仅显示短值，可用键盘按钮展开完整值并复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FullValueDisclosure label="sha256" value="abcdef0123456789" preview="abcdef012345…" />);

    const toggle = screen.getByRole('button', { name: /sha256 abcdef012345…/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('sha256完整值')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('sha256完整值')).toHaveTextContent('abcdef0123456789');

    fireEvent.click(screen.getByRole('button', { name: '复制完整值' }));
    expect(writeText).toHaveBeenCalledWith('abcdef0123456789');
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('复制失败时提供可操作的手动复制提示', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    render(<FullValueDisclosure label="对象摘要" value="full-value" preview="full-value…" />);
    fireEvent.click(screen.getByRole('button', { name: /对象摘要 full-value/ }));
    fireEvent.click(screen.getByRole('button', { name: '复制完整值' }));

    expect(await screen.findByRole('status')).toHaveTextContent('无法自动复制');
  });
});
