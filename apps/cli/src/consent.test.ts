import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  stdin: { isTTY: true },
  isWindows: true,
  question: vi.fn(),
  close: vi.fn(),
}));
vi.mock('node:process', () => ({ stdin: state.stdin, stdout: {} }));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: state.question, close: state.close }),
}));
vi.mock('./private-fs', () => ({
  get IS_WINDOWS() {
    return state.isWindows;
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.stdin.isTTY = true;
  state.isWindows = true;
  state.question.mockReset().mockResolvedValue('yes');
  state.close.mockReset();
});

describe('file store consent', () => {
  it('describes NTFS permissions on Windows without claiming POSIX file modes', async () => {
    const { confirmFileStore } = await import('./consent');
    await confirmFileStore();
    const prompt = state.question.mock.calls[0][0] as string;
    expect(prompt).toContain('NTFS 权限关闭继承并仅授权当前用户');
    expect(prompt).not.toContain('0600');
    expect(prompt).toContain('不宣称对同一 OS 用户加密隔离');
    expect(state.close).toHaveBeenCalledOnce();
  });

  it('retains the POSIX permissions prompt on other platforms', async () => {
    state.isWindows = false;
    const { confirmFileStore } = await import('./consent');
    await confirmFileStore();
    expect(state.question.mock.calls[0][0]).toContain('0600');
  });

  it('still requires explicit consent in noninteractive environments', async () => {
    state.stdin.isTTY = false;
    const { confirmFileStore } = await import('./consent');
    await expect(confirmFileStore()).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(state.question).not.toHaveBeenCalled();
  });

  it('rejects answers other than yes and closes the prompt', async () => {
    state.question.mockResolvedValue('no');
    const { confirmFileStore } = await import('./consent');
    await expect(confirmFileStore()).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(state.close).toHaveBeenCalledOnce();
  });
});
