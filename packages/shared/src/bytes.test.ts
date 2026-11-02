import { describe, expect, it } from 'vitest';
import { sha256Bytes } from './bytes';

describe('sha256Bytes', () => {
  it('hashes original UTF-8 bytes without normalization', async () => {
    expect(await sha256Bytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Bytes(new Uint8Array([0xff, 0x00]))).not.toBe(
      await sha256Bytes(new TextEncoder().encode('�\u0000')),
    );
  });
});
