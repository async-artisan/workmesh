import { describe, expect, it } from 'vitest';
import {
  assertCookieDeployment,
  csrfCookieOptions,
  sessionCookieOptions,
} from './v1-cookie-policy';

describe('v1 cookie deployment policy', () => {
  it('uses HttpOnly session and readable csrf cookies', () => {
    expect(sessionCookieOptions('SECURE', 600)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(csrfCookieOptions('LOCAL_INSECURE', 600)).toMatchObject({
      httpOnly: false,
      secure: false,
    });
  });

  it('does not allow insecure mode off loopback', () => {
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'http://example.test')).toThrow(
      'LOOPBACK',
    );
    expect(() => assertCookieDeployment('SECURE', 'http://127.0.0.1:3000')).toThrow('HTTPS');
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'http://127.0.0.1:3000')).not.toThrow();
  });
});
