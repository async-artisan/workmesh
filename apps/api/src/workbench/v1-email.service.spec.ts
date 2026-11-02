import { afterEach, describe, expect, it } from 'vitest';
import { V1EmailService } from './v1-email.service';

describe('V1EmailService', () => {
  const original = process.env.WORKMESH_SMTP_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.WORKMESH_SMTP_URL;
    else process.env.WORKMESH_SMTP_URL = original;
  });

  it('未配置 SMTP 时返回 503 EMAIL_NOT_CONFIGURED', async () => {
    delete process.env.WORKMESH_SMTP_URL;
    const service = new V1EmailService();

    expect(service.isConfigured()).toBe(false);
    await expect(service.send('a@example.com', 'subject', 'body')).rejects.toMatchObject({
      code: 'EMAIL_NOT_CONFIGURED',
      message: 'EMAIL_NOT_CONFIGURED',
      status: 503,
    });
  });
});
