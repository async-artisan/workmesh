import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: lookup }),
}));

beforeEach(() => {
  vi.resetModules();
  lookup.mockReset();
});

describe('Windows process identity lookup', () => {
  it('shares one successful OS lookup between concurrent file permission operations', async () => {
    lookup.mockResolvedValue({ stdout: 'DOMAIN\\Alice\r\n' });
    const { currentPrincipal } = await import('./private-fs');
    expect(await Promise.all(Array.from({ length: 20 }, () => currentPrincipal()))).toEqual(
      Array(20).fill('DOMAIN\\ALICE'),
    );
    expect(lookup).toHaveBeenCalledExactlyOnceWith('whoami', [], { windowsHide: true });
    expect(await currentPrincipal()).toBe('DOMAIN\\ALICE');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not permanently cache a failed or malformed identity lookup', async () => {
    lookup
      .mockRejectedValueOnce(new Error('OS lookup failed'))
      .mockResolvedValueOnce({ stdout: 'invalid' })
      .mockResolvedValueOnce({ stdout: 'DOMAIN\\Alice' });
    const { currentPrincipal } = await import('./private-fs');
    await expect(currentPrincipal()).rejects.toThrow('OS lookup failed');
    await expect(currentPrincipal()).rejects.toThrow('DOMAIN');
    expect(await currentPrincipal()).toBe('DOMAIN\\ALICE');
    expect(lookup).toHaveBeenCalledTimes(3);
  });
});
