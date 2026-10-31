import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
export class EncryptionUtil {
  private static algorithm = 'aes-256-gcm';
  static encrypt(value: string, key: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, Buffer.from(key, 'base64'), iv) as CipherGCM;
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }
  static decrypt(value: string, key: string) {
    const [iv, tag, encrypted] = value.split('.');
    const decipher = createDecipheriv(
      this.algorithm,
      Buffer.from(key, 'base64'),
      Buffer.from(iv, 'base64'),
    ) as DecipherGCM;
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
