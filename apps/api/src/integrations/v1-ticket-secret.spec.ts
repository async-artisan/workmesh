import { describe, expect, it } from 'vitest';
import { openTicketSecret, sealTicketSecret } from './v1-ticket-secret';

describe('encrypted replay of ticket secrets', () => {
  const key = 'a'.repeat(64);
  const binding = 'project:user:ticket:request-digest';
  it('round trips only with the original deployment key and operation binding', () => {
    const sealed = sealTicketSecret('fixture-secret', key, binding);
    expect(sealed).not.toContain('fixture-secret');
    expect(openTicketSecret(sealed, key, binding)).toBe('fixture-secret');
    expect(() => openTicketSecret(sealed, 'b'.repeat(64), binding)).toThrow();
    expect(() => openTicketSecret(sealed, key, 'another-project:user:ticket:digest')).toThrow();
    expect(sealTicketSecret('fixture-secret', key, binding)).not.toBe(sealed);
  });
  it('rejects tampering, plaintext legacy records, and missing or invalid keys', () => {
    const sealed = sealTicketSecret('fixture-secret', key, binding);
    const fields = sealed.split('.');
    fields[2] = '0'.repeat(32);
    expect(() => openTicketSecret(fields.join('.'), key, binding)).toThrow();
    for (const value of ['fixture-secret', 'v1.not.hex.record', 'v1.00.00.00'])
      expect(() => openTicketSecret(value, key, binding)).toThrow();
    expect(() => sealTicketSecret('fixture-secret', '', binding)).toThrow(
      'TICKET_ENCRYPTION_KEY_REQUIRED',
    );
    expect(() => sealTicketSecret('fixture-secret', 'x'.repeat(64), binding)).toThrow();
  });
});
