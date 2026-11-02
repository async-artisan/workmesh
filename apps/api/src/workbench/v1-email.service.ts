import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

/**
 * SMTP 邮件发送。只有配置了 WORKMESH_SMTP_URL 才可用；
 * 未配置时返回 503 EMAIL_NOT_CONFIGURED，不静默吞掉。
 */
@Injectable()
export class V1EmailService {
  private transporter: nodemailer.Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.WORKMESH_SMTP_URL?.trim());
  }

  private transport(): nodemailer.Transporter {
    const urlText = process.env.WORKMESH_SMTP_URL?.trim();
    if (!urlText)
      throw new WorkmeshError(
        V1_ERROR_CODES.EMAIL_NOT_CONFIGURED,
        'EMAIL_NOT_CONFIGURED',
        { env: 'WORKMESH_SMTP_URL' },
        503,
      );
    if (this.transporter) return this.transporter;

    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      throw new WorkmeshError(
        V1_ERROR_CODES.EMAIL_NOT_CONFIGURED,
        'EMAIL_NOT_CONFIGURED',
        { env: 'WORKMESH_SMTP_URL', reason: 'INVALID_URL' },
        503,
      );
    }
    this.transporter = nodemailer.createTransport({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
      secure: url.protocol === 'smtps:',
      auth: url.username
        ? {
            user: decodeURIComponent(url.username),
            pass: decodeURIComponent(url.password),
          }
        : undefined,
    });
    return this.transporter;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    const from = process.env.WORKMESH_EMAIL_FROM?.trim() || 'no-reply@workmesh.local';
    await this.transport().sendMail({ from, to, subject, text });
  }
}
