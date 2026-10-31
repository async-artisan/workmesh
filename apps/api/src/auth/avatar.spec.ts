import { describe, expect, it } from 'vitest';
import { isValidAvatar } from './avatar';

describe('avatar file contract', () => {
  it('accepts a matching PNG signature and rejects spoofed image MIME types', () => {
    expect(isValidAvatar('image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(isValidAvatar('image/png', Buffer.from('not an image'))).toBe(false);
    expect(isValidAvatar('image/gif', Buffer.from('GIF89a'))).toBe(false);
  });
});
