import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Deployment-owned key, separate from the webhook secret; never stored in the database. */
function keyBytes(key: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('TICKET_ENCRYPTION_KEY_REQUIRED');
  return Buffer.from(key, 'hex');
}

export function sealTicketSecret(secret: string, key: string, binding: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(binding, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join('.');
}

export function openTicketSecret(sealed: string, key: string, binding: string): string {
  const parts = sealed.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== 'v1' ||
    !/^[0-9a-f]{24}$/.test(parts[1]) ||
    !/^[0-9a-f]{32}$/.test(parts[2]) ||
    !/^(?:[0-9a-f]{2})+$/.test(parts[3])
  )
    throw new Error('INVALID_SEALED_TICKET_SECRET');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(parts[1], 'hex'));
  decipher.setAAD(Buffer.from(binding, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
