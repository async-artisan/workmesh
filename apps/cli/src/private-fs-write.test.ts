import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { files, lookup, platform } = vi.hoisted(() => ({
  files: {
    chmod: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
  },
  lookup: vi.fn(),
  platform: vi.fn(),
}));

vi.mock('node:fs/promises', () => files);
vi.mock('node:os', () => ({ platform }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: lookup }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  for (const operation of Object.values(files)) operation.mockReset().mockResolvedValue(undefined);
  platform.mockReset().mockReturnValue('win32');
  lookup.mockReset().mockImplementation(async (executable: string) => ({
    stdout: executable.endsWith('whoami.exe') ? 'DOMAIN\\Alice' : '',
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('private atomic file replacement', () => {
  it('retries a transient Windows sharing conflict without rewriting or deleting the destination', async () => {
    files.rename
      .mockRejectedValueOnce(Object.assign(new Error('reader holds file'), { code: 'EPERM' }))
      .mockRejectedValueOnce(Object.assign(new Error('scanner holds file'), { code: 'EACCES' }))
      .mockRejectedValueOnce(Object.assign(new Error('file is busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined);
    const { writePrivateFile } = await import('./private-fs');
    const completed = expect(
      writePrivateFile('G:\\project\\workspace.json', 'next'),
    ).resolves.toBeUndefined();
    await Promise.all([completed, vi.runAllTimersAsync()]);
    expect(files.writeFile).toHaveBeenCalledTimes(1);
    const temporary = files.writeFile.mock.calls[0][0];
    expect(temporary).not.toBe('G:\\project\\workspace.json');
    expect(files.rename.mock.calls).toEqual(
      Array(4).fill([temporary, 'G:\\project\\workspace.json']),
    );
    expect(lookup).toHaveBeenLastCalledWith(
      'C:\\Windows\\System32\\icacls.exe',
      ['G:\\project\\workspace.json', '/inheritance:r', '/grant:r', 'DOMAIN\\ALICE:F'],
      { windowsHide: true },
    );
  });

  it('keeps a persistent Windows denial as a failure after a bounded wait', async () => {
    const failure = Object.assign(new Error('access remains denied'), { code: 'EPERM' });
    files.rename.mockRejectedValue(failure);
    const { writePrivateFile } = await import('./private-fs');
    const completed = expect(writePrivateFile('G:\\project\\workspace.json', 'next')).rejects.toBe(
      failure,
    );
    await Promise.all([completed, vi.advanceTimersByTimeAsync(1_000)]);
    expect(vi.getTimerCount()).toBe(0);
    expect(files.writeFile).toHaveBeenCalledTimes(1);
    expect(files.rename.mock.calls.length).toBeGreaterThan(1);
    expect(files.rename.mock.calls.length).toBeLessThanOrEqual(10);
    expect(lookup.mock.calls.some(([, args]) => args[0] === 'G:\\project\\workspace.json')).toBe(
      false,
    );
  });

  it('does not retry a missing source or another non-sharing error', async () => {
    const failure = Object.assign(new Error('source disappeared'), { code: 'ENOENT' });
    files.rename.mockRejectedValue(failure);
    const { writePrivateFile } = await import('./private-fs');
    await expect(writePrivateFile('G:\\project\\workspace.json', 'next')).rejects.toBe(failure);
    expect(files.rename).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves immediate POSIX permission failures and private staging mode', async () => {
    platform.mockReturnValue('linux');
    const failure = Object.assign(new Error('permission denied'), { code: 'EPERM' });
    files.rename.mockRejectedValue(failure);
    const { writePrivateFile } = await import('./private-fs');
    await expect(writePrivateFile('/project/workspace.json', 'next')).rejects.toBe(failure);
    expect(files.rename).toHaveBeenCalledTimes(1);
    expect(files.writeFile).toHaveBeenCalledWith(expect.any(String), 'next', {
      mode: 0o600,
      flag: 'w',
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
