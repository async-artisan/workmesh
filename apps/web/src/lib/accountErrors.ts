import { ApiError, formatApiError } from '../api/client';

export type AccountErrorPage = 'login' | 'register' | 'invite';

export type AccountErrorKind =
  | 'invalid-credentials'
  | 'email-in-use'
  | 'email-already-registered'
  | 'invalid-input'
  | 'rate-limited'
  | 'invitation-not-found'
  | 'invitation-expired'
  | 'invitation-revoked'
  | 'invitation-already-accepted'
  | 'conflict'
  | 'generic';

export interface AccountErrorView {
  kind: AccountErrorKind;
  /** 面向用户的中文说明，不直接暴露服务端 code。 */
  message: string;
  /** 技术详情，放在可展开区域；不包含密码、session 或 token。 */
  detail?: string;
  requestId?: string;
}

/**
 * 邀请接受页的真实 wire response：
 * HTTP 409, error.code=RESOURCE_CONFLICT, error.message=EMAIL_ALREADY_REGISTERED。
 * 必须同时满足这三项，不能把所有 409/RESOURCE_CONFLICT 都当成邮箱已注册。
 */
export function isEmailAlreadyRegistered(caught: unknown): boolean {
  return (
    caught instanceof ApiError &&
    caught.status === 409 &&
    caught.code === 'RESOURCE_CONFLICT' &&
    caught.message === 'EMAIL_ALREADY_REGISTERED'
  );
}

function technical(caught: unknown): { detail: string; requestId?: string } {
  return {
    detail: formatApiError(caught),
    requestId: caught instanceof ApiError ? caught.requestId : undefined,
  };
}

/**
 * 账号入口页面的窄范围错误映射。未知错误只给通用中文说明；
 * 技术 code/message/requestId 保留在 detail 中，供“查看详细信息”展开。
 */
export function describeAccountError(caught: unknown, page: AccountErrorPage): AccountErrorView {
  const base = technical(caught);

  if (caught instanceof ApiError) {
    if (caught.status === 429) {
      return {
        ...base,
        kind: 'rate-limited',
        message: '请求过于频繁，请稍后再试。',
      };
    }

    if (page === 'login') {
      if (caught.status === 401 && caught.code === 'AUTH_INVALID') {
        return {
          ...base,
          kind: 'invalid-credentials',
          message: '邮箱或密码不正确，请重新输入。',
        };
      }
      if (caught.status === 401) {
        return {
          ...base,
          kind: 'generic',
          message: '登录失败，请确认账号状态或稍后重试。',
        };
      }
      return {
        ...base,
        kind: 'generic',
        message: '登录失败，请检查网络或稍后重试。',
      };
    }

    if (page === 'register') {
      if (caught.status === 409 && caught.code === 'EMAIL_IN_USE') {
        return {
          ...base,
          kind: 'email-in-use',
          message: '该邮箱已注册，请直接登录。',
        };
      }
      // 服务端注册校验只确认了两组精确契约：
      // 400 + INVALID_REQUEST，或 422 + VALIDATION_FAILED。
      // 不能把 status 与 code 拆成两个独立集合，否则 400 + VALIDATION_FAILED
      // 或 422 + INVALID_REQUEST 这类未确认组合会被误导成表单校验错误。
      const knownValidationError =
        (caught.status === 400 && caught.code === 'INVALID_REQUEST') ||
        (caught.status === 422 && caught.code === 'VALIDATION_FAILED');
      if (knownValidationError) {
        return {
          ...base,
          kind: 'invalid-input',
          message:
            '注册信息不符合要求，请检查邮箱格式、密码长度（8–200 个字符）和姓名长度（最多 80 个字符）。',
        };
      }
      return {
        ...base,
        kind: 'generic',
        message: '注册失败，请检查网络或稍后重试。',
      };
    }

    if (isEmailAlreadyRegistered(caught)) {
      return {
        ...base,
        kind: 'email-already-registered',
        message: '这个邮箱已经有账号，请先登录再接受邀请。',
      };
    }
    if (caught.status === 409 && caught.message === 'INVITATION_ALREADY_ACCEPTED') {
      return {
        ...base,
        kind: 'invitation-already-accepted',
        message: '这个邀请已经被接受过了。',
      };
    }
    if (caught.code === 'RESOURCE_NOT_FOUND') {
      if (caught.message === 'INVITATION_NOT_FOUND') {
        return {
          ...base,
          kind: 'invitation-not-found',
          message: '邀请链接无效或已失效。',
        };
      }
      if (caught.message === 'INVITATION_EXPIRED') {
        return {
          ...base,
          kind: 'invitation-expired',
          message: '这个邀请已经过期，请联系管理员重新生成。',
        };
      }
      if (caught.message === 'INVITATION_REVOKED') {
        return {
          ...base,
          kind: 'invitation-revoked',
          message: '这个邀请已被撤回，请联系管理员重新发送。',
        };
      }
    }
    if (caught.status === 409) {
      return {
        ...base,
        kind: 'conflict',
        message: '邀请状态已发生变化，请刷新页面后重试。',
      };
    }
    if (caught.status === 401) {
      return {
        ...base,
        kind: 'generic',
        message: '当前账号不可用，请重新登录后再试。',
      };
    }
    return {
      ...base,
      kind: 'generic',
      message: '邀请操作失败，请检查网络或稍后重试。',
    };
  }

  const generic =
    page === 'login'
      ? '登录失败，请检查网络后重试。'
      : page === 'register'
        ? '注册失败，请检查网络后重试。'
        : '邀请操作失败，请检查网络后重试。';
  return { ...base, kind: 'generic', message: generic };
}
