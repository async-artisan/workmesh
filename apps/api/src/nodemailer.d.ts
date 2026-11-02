declare module 'nodemailer' {
  export interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(options: string | Record<string, unknown>): Transporter;
}
