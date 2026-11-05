import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { describeAccountError, isEmailAlreadyRegistered } from './accountErrors';

function conflict(message: string, details?: Record<string, unknown>) {
  return new ApiError(409, 'RESOURCE_CONFLICT', message, details, 'req-conflict');
}

describe('accountErrors（账号入口窄范围错误映射）', () => {
  it('只把 409 RESOURCE_CONFLICT + EMAIL_ALREADY_REGISTERED 识别为邮箱已注册', () => {
    const registered = conflict('EMAIL_ALREADY_REGISTERED', { email: 'old@example.com' });
    expect(isEmailAlreadyRegistered(registered)).toBe(true);

    const otherConflict = conflict('PROJECT_VERSION_CONFLICT');
    expect(isEmailAlreadyRegistered(otherConflict)).toBe(false);
    expect(describeAccountError(otherConflict, 'invite')).toMatchObject({
      kind: 'conflict',
      message: '邀请状态已发生变化，请刷新页面后重试。',
    });
    expect(describeAccountError(otherConflict, 'invite').message).not.toContain('先登录');

    expect(isEmailAlreadyRegistered(new ApiError(409, 'EMAIL_IN_USE', '该邮箱已注册'))).toBe(false);
    expect(isEmailAlreadyRegistered(new Error('409'))).toBe(false);
  });

  it('邀请页错误保留可读中文与技术详情，不把所有 409 都当邮箱冲突', () => {
    const emailRegistered = describeAccountError(
      conflict('EMAIL_ALREADY_REGISTERED', { email: 'old@example.com' }),
      'invite',
    );
    expect(emailRegistered.kind).toBe('email-already-registered');
    expect(emailRegistered.message).toBe('这个邮箱已经有账号，请先登录再接受邀请。');
    expect(emailRegistered.detail).toContain('[RESOURCE_CONFLICT] EMAIL_ALREADY_REGISTERED');
    expect(emailRegistered.requestId).toBe('req-conflict');

    expect(describeAccountError(conflict('INVITATION_ALREADY_ACCEPTED'), 'invite').message).toBe(
      '这个邀请已经被接受过了。',
    );
    expect(
      describeAccountError(
        new ApiError(404, 'RESOURCE_NOT_FOUND', 'INVITATION_NOT_FOUND'),
        'invite',
      ).message,
    ).toBe('邀请链接无效或已失效。');
    expect(
      describeAccountError(new ApiError(410, 'RESOURCE_NOT_FOUND', 'INVITATION_EXPIRED'), 'invite')
        .message,
    ).toBe('这个邀请已经过期，请联系管理员重新生成。');
    expect(
      describeAccountError(new ApiError(410, 'RESOURCE_NOT_FOUND', 'INVITATION_REVOKED'), 'invite')
        .message,
    ).toBe('这个邀请已被撤回，请联系管理员重新发送。');
  });

  it('登录页只对 AUTH_INVALID 提示邮箱或密码错误', () => {
    expect(
      describeAccountError(new ApiError(401, 'AUTH_INVALID', '邮箱或密码不正确'), 'login'),
    ).toMatchObject({
      kind: 'invalid-credentials',
      message: '邮箱或密码不正确，请重新输入。',
    });
    expect(
      describeAccountError(new ApiError(401, 'AUTH_REQUIRED', '会话已失效'), 'login').message,
    ).toBe('登录失败，请确认账号状态或稍后重试。');
    expect(
      describeAccountError(new ApiError(500, 'INTERNAL_ERROR', '服务异常'), 'login').message,
    ).toBe('登录失败，请检查网络或稍后重试。');
  });

  it('注册页只对 EMAIL_IN_USE 提示邮箱已注册，输入校验错误可读', () => {
    expect(
      describeAccountError(new ApiError(409, 'EMAIL_IN_USE', '该邮箱已注册'), 'register'),
    ).toMatchObject({
      kind: 'email-in-use',
      message: '该邮箱已注册，请直接登录。',
    });
    expect(
      describeAccountError(new ApiError(409, 'RESOURCE_CONFLICT', 'OTHER'), 'register').kind,
    ).not.toBe('email-in-use');
    expect(
      describeAccountError(new ApiError(400, 'INVALID_REQUEST', '密码长度错误'), 'register')
        .message,
    ).toContain('8–200');
  });

  it('注册输入校验错误必须精确匹配 code/status 组合，反向组合与未知 400/422 使用通用错误', () => {
    for (const [status, code] of [
      [400, 'INVALID_REQUEST'],
      [422, 'VALIDATION_FAILED'],
    ] as const) {
      expect(
        describeAccountError(new ApiError(status, code, '校验失败'), 'register'),
      ).toMatchObject({
        kind: 'invalid-input',
        message:
          '注册信息不符合要求，请检查邮箱格式、密码长度（8–200 个字符）和姓名长度（最多 80 个字符）。',
      });
    }

    for (const [status, code] of [
      [400, 'VALIDATION_FAILED'],
      [422, 'INVALID_REQUEST'],
      [400, 'SOMETHING_NEW'],
      [422, 'AUTH_INVALID'],
    ] as const) {
      const unknown = describeAccountError(new ApiError(status, code, '未知错误'), 'register');
      expect(unknown.kind).toBe('generic');
      expect(unknown.message).toBe('注册失败，请检查网络或稍后重试。');
      expect(unknown.message).not.toMatch(/邮箱|密码|姓名/);
    }

    // 409 的既有窄范围行为保持不变。
    expect(
      describeAccountError(new ApiError(409, 'EMAIL_IN_USE', '该邮箱已注册'), 'register').kind,
    ).toBe('email-in-use');
    expect(
      describeAccountError(new ApiError(409, 'RESOURCE_CONFLICT', 'OTHER'), 'register').kind,
    ).not.toBe('email-in-use');
  });

  it('429 与未知网络错误使用通用中文说明，技术详情仍可展开', () => {
    expect(
      describeAccountError(new ApiError(429, 'RATE_LIMITED', '请求过于频繁'), 'login'),
    ).toMatchObject({
      kind: 'rate-limited',
      message: '请求过于频繁，请稍后再试。',
    });
    const network = describeAccountError(new TypeError('Failed to fetch'), 'register');
    expect(network.kind).toBe('generic');
    expect(network.message).toBe('注册失败，请检查网络后重试。');
    expect(network.detail).toContain('Failed to fetch');
  });
});
