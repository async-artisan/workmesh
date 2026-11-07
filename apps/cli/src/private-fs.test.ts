import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: lookup }),
}));

beforeEach(() => {
  vi.resetModules();
  lookup.mockReset();
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  vi.stubEnv('windir', 'C:\\Fallback Windows');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Windows process identity lookup', () => {
  it('shares one successful OS lookup between concurrent file permission operations', async () => {
    lookup.mockResolvedValue({ stdout: 'DOMAIN\\Alice\r\n' });
    const { currentPrincipal } = await import('./private-fs');
    expect(await Promise.all(Array.from({ length: 20 }, () => currentPrincipal()))).toEqual(
      Array(20).fill('DOMAIN\\ALICE'),
    );
    expect(lookup).toHaveBeenCalledExactlyOnceWith('C:\\Windows\\System32\\whoami.exe', [], {
      windowsHide: true,
    });
    expect(await currentPrincipal()).toBe('DOMAIN\\ALICE');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not permanently cache a failed or malformed identity lookup', async () => {
    lookup
      .mockRejectedValueOnce(new Error('OS lookup failed'))
      .mockResolvedValueOnce({ stdout: 'invalid' })
      .mockResolvedValueOnce({ stdout: 'DOMAIN\\Alice' });
    const { currentPrincipal } = await import('./private-fs');
    await expect(currentPrincipal()).rejects.toThrow('Windows 身份识别失败');
    await expect(currentPrincipal()).rejects.toThrow('DOMAIN');
    expect(await currentPrincipal()).toBe('DOMAIN\\ALICE');
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('uses native absolute executables despite a polluted PATH and handles spaces without a shell', async () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows With Spaces');
    vi.stubEnv('PATH', 'C:\\Program Files\\Git\\usr\\bin');
    lookup.mockResolvedValue({ stdout: 'DOMAIN\\Alice' });
    const { hardenWindowsPath } = await import('./private-fs');
    const target = 'G:\\workspace with spaces\\credentials.json';
    await hardenWindowsPath(target, false);
    expect(lookup.mock.calls).toEqual([
      ['C:\\Windows With Spaces\\System32\\whoami.exe', [], { windowsHide: true }],
      [
        'C:\\Windows With Spaces\\System32\\icacls.exe',
        [target, '/inheritance:r', '/grant:r', 'DOMAIN\\ALICE:F'],
        { windowsHide: true },
      ],
    ]);
  });

  it('falls back to windir only when SystemRoot is absent', async () => {
    vi.stubEnv('SystemRoot', undefined);
    lookup.mockResolvedValue({ stdout: 'DOMAIN\\Alice' });
    const { currentPrincipal } = await import('./private-fs');
    await currentPrincipal();
    expect(lookup).toHaveBeenCalledWith('C:\\Fallback Windows\\System32\\whoami.exe', [], {
      windowsHide: true,
    });
  });

  it('refuses missing or relative system roots instead of falling back to PATH', async () => {
    vi.stubEnv('SystemRoot', undefined);
    vi.stubEnv('windir', undefined);
    const { currentPrincipal } = await import('./private-fs');
    await expect(currentPrincipal()).rejects.toThrow('Windows 系统工具定位失败');
    vi.stubEnv('SystemRoot', 'relative-windows');
    await expect(currentPrincipal()).rejects.toThrow('绝对路径');
    vi.stubEnv('SystemRoot', '\\Windows');
    await expect(currentPrincipal()).rejects.toThrow('带盘符的绝对路径');
    vi.stubEnv('SystemRoot', 'C:Windows');
    await expect(currentPrincipal()).rejects.toThrow('带盘符的绝对路径');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports executable and stage while excluding child process output', async () => {
    lookup.mockRejectedValue(
      Object.assign(new Error('secret child output'), {
        code: 'ENOENT',
        stdout: 'secret stdout',
        stderr: 'secret stderr',
      }),
    );
    const { currentPrincipal } = await import('./private-fs');
    await expect(currentPrincipal()).rejects.toThrow(
      'Windows 身份识别失败：无法执行 C:\\Windows\\System32\\whoami.exe（ENOENT）',
    );
    await expect(currentPrincipal()).rejects.not.toThrow('secret');
  });

  it('reports permission operation and target without leaking child output', async () => {
    lookup
      .mockResolvedValueOnce({ stdout: 'DOMAIN\\Alice' })
      .mockRejectedValueOnce(Object.assign(new Error('secret child output'), { code: 5 }));
    const { hardenWindowsPath } = await import('./private-fs');
    await expect(hardenWindowsPath('G:\\workspace\\credentials.json', true)).rejects.toThrow(
      'Windows 凭据权限设置失败：无法执行 C:\\Windows\\System32\\icacls.exe（5）；目标：G:\\workspace\\credentials.json',
    );
  });

  it('keeps rejecting inherited grants and other users while ignoring integrity labels', async () => {
    lookup
      .mockResolvedValueOnce({ stdout: 'DOMAIN\\Alice' })
      .mockResolvedValueOnce({
        stdout:
          'G:\\private DOMAIN\\Alice:(F)\r\n  Mandatory Label\\Medium Mandatory Level:(I)(NW)',
      })
      .mockResolvedValueOnce({ stdout: 'G:\\private DOMAIN\\Alice:(I)(F)' })
      .mockResolvedValueOnce({ stdout: 'G:\\private DOMAIN\\Bob:(F)' });
    const { verifyWindowsPath } = await import('./private-fs');
    await expect(verifyWindowsPath('G:\\private')).resolves.toBeUndefined();
    await expect(verifyWindowsPath('G:\\private')).rejects.toThrow('含继承权限');
    await expect(verifyWindowsPath('G:\\private')).rejects.toThrow('对其他主体授予了权限');
    expect(
      lookup.mock.calls
        .slice(1)
        .every(([executable]) => executable === 'C:\\Windows\\System32\\icacls.exe'),
    ).toBe(true);
  });
});
