import { describe, expect, it } from 'vitest';
import { cookieNames, assertCookieDeployment, resolveCookieMode } from './v1-cookie-policy';
import {
  equalSecret,
  hashSecret,
  hasScope,
  parseOpaqueSessionCookie,
  rejectSelfAssertedIdentity,
  validateCsrf,
  validateOrigin,
} from './v1-policy';

describe('v1 identity policy', () => {
  it('hashes and compares secrets in constant-time shape', () => {
    const hash = hashSecret('secret');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(equalSecret('secret', hash)).toBe(true);
    expect(equalSecret('other', hash)).toBe(false);
  });

  it('parses only opaque session cookie format', () => {
    const value = 'wm_s1.123e4567-e89b-12d3-a456-426614174000.A'.repeat(1);
    expect(parseOpaqueSessionCookie(value)).toBeNull();
    expect(
      parseOpaqueSessionCookie(
        'wm_s1.123e4567-e89b-12d3-a456-426614174000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toEqual({
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  });

  it('rejects body identity claims instead of trusting them', () => {
    expect(() => rejectSelfAssertedIdentity({ actorType: 'HUMAN' })).toThrow('self-asserted');
    expect(() => rejectSelfAssertedIdentity({ userId: 'attacker' })).toThrow('self-asserted');
    expect(() => rejectSelfAssertedIdentity({ title: 'safe' })).not.toThrow();
  });

  it('requires exact origin and matching csrf token', () => {
    expect(validateOrigin('https://example.test', 'https://example.test')).toBe(true);
    expect(validateOrigin('https://example.test.evil', 'https://example.test')).toBe(false);
    expect(validateOrigin(undefined, 'https://example.test')).toBe(false);
    expect(validateOrigin('null', 'https://example.test')).toBe(false);
    expect(validateOrigin('https://example.test:8443', 'https://example.test')).toBe(false);
  });

  it('rejects CSRF values that are equal but do not match the session digest', () => {
    const token = 'A'.repeat(43);
    expect(validateCsrf(token, token, hashSecret(token))).toBe(true);
    // 两值相等但摘要不匹配：不能通过
    expect(validateCsrf(token, token, hashSecret('B'.repeat(43)))).toBe(false);
    // 只给 header 或只给 cookie 也不通过
    expect(validateCsrf(token, undefined, hashSecret(token))).toBe(false);
    expect(validateCsrf(undefined, token, hashSecret(token))).toBe(false);
    // header 与 cookie 不相等
    expect(validateCsrf(token, 'B'.repeat(43), hashSecret(token))).toBe(false);
    // 长度不是 43 的 base64url 原值不通过
    expect(validateCsrf('A'.repeat(42), 'A'.repeat(42), hashSecret('A'.repeat(42)))).toBe(false);
  });

  it('does not grant agent scopes by role name', () => {
    expect(
      hasScope({ kind: 'AGENT', userId: 'u', roleIds: ['role'], scopes: [] }, 'task:deliver'),
    ).toBe(false);
    expect(
      hasScope(
        { kind: 'AGENT', userId: 'u', roleIds: ['role'], scopes: ['task:deliver'] },
        'task:deliver',
      ),
    ).toBe(true);
    expect(hasScope({ kind: 'HUMAN', userId: 'u', scopes: [] }, 'task:deliver')).toBe(true);
  });

  it('uses __Host- cookie names in secure mode and loopback-only names in dev mode', () => {
    expect(cookieNames('SECURE')).toEqual({ session: '__Host-wm_session', csrf: '__Host-wm_csrf' });
    expect(cookieNames('LOCAL_INSECURE')).toEqual({ session: 'wm_session', csrf: 'wm_csrf' });
    expect(resolveCookieMode(undefined)).toBe('SECURE');
    expect(resolveCookieMode('LOCAL_INSECURE')).toBe('LOCAL_INSECURE');
  });

  it('refuses insecure or non-loopback cookie deployments', () => {
    expect(() => assertCookieDeployment('SECURE', 'http://workmesh.local')).toThrow(
      'SECURE_REQUIRES_HTTPS',
    );
    expect(() => assertCookieDeployment('SECURE', 'https://workmesh.local')).not.toThrow();
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'https://127.0.0.1:5173')).toThrow(
      'LOCAL_MODE_REQUIRES_HTTP',
    );
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'http://127.0.0.1:5173')).not.toThrow();
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'http://localhost:5173')).not.toThrow();
    // 局域网 IP / 生产主机不能启用开发例外
    expect(() => assertCookieDeployment('LOCAL_INSECURE', 'http://192.168.1.10:5173')).toThrow(
      'LOCAL_MODE_LOOPBACK_ONLY',
    );
  });
});
