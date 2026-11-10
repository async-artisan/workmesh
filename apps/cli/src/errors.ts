export type ExitCode = 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 130;

const CODE_EXIT: Readonly<Record<string, ExitCode>> = {
  USAGE: 2,
  INVALID_REQUEST: 2,
  VALIDATION_FAILED: 2,
  CONFIG_NOT_FOUND: 2,
  CONFIG_SCHEMA_UNSUPPORTED: 2,
  PACKAGE_MANIFEST_INVALID: 2,
  PACKAGE_INCOMPATIBLE: 2,
  PACKAGE_NOT_FOUND: 2,
  PACKAGE_ROLE_MISMATCH: 2,
  CREDENTIAL_STORE_UNSAFE: 2,
  HOST_OS_UNSUPPORTED: 2,
  LOCAL_INPUT_INVALID: 2,
  APPROVAL_REQUIRED: 2,

  AUTH_REQUIRED: 3,
  AUTH_INVALID: 3,
  AUTH_EXPIRED: 3,
  SESSION_EXPIRED: 3,
  CREDENTIAL_REVOKED: 3,
  AUTHORIZATION_EXPIRED: 3,

  FORBIDDEN: 4,
  SCOPE_DENIED: 4,
  HUMAN_SESSION_REQUIRED: 4,
  AUTHORIZATION_DENIED: 4,
  CSRF_REJECTED: 4,
  ORIGIN_REJECTED: 4,

  VERSION_CONFLICT: 5,
  ACTION_CHANGED: 5,
  IDEMPOTENCY_CONFLICT: 5,
  CLAIM_CONFLICT: 5,
  CLAIM_INVALID: 5,
  BASELINE_STALE: 5,
  CONFIRMATION_USED: 5,
  RESOURCE_CONFLICT: 5,
  WORK_STATUS_CONFLICT: 5,
  LAST_OWNER_REQUIRED: 5,
  REVIEW_CLOSED: 5,
  EXECUTION_BUSY: 5,
  EXECUTION_AMBIGUOUS: 5,
  EXECUTION_PENDING: 5,
  EXECUTION_DELIVERED: 5,

  // 本机工作区配置五态与接入（§14.3）：DUAL_ACTIVE 是硬冲突，固定退出码 5。
  WORKSPACE_DUAL_CONFIG: 5,
  WORKSPACE_ALREADY_BOUND: 5,
  WORKSPACE_INIT_IN_PROGRESS: 5,
  WORKSPACE_REPO_MISMATCH: 5,
  WORKSPACE_AMBIGUOUS: 5,
  WORKSPACE_CONTEXT_STALE: 5,
  WORKSPACE_V1_MIGRATION_REQUIRED: 2,
  WORKSPACE_NOT_CONFIGURED: 2,
  WORKSPACE_DEFINITION_REQUIRED: 2,
  WORKSPACE_PATH_OUTSIDE_ROOT: 2,
  WORKSPACE_REPO_NOT_FOUND: 2,
  WORKSPACE_OFFLINE_UNVERIFIED: 6,
  WORKSPACE_WRITE_FAILED: 9,

  WORKFLOW_BLOCKED: 6,
  STALE_INPUT: 6,
  GATE_NOT_SATISFIED: 6,
  WORKFLOW_INVALID: 6,
  REVIEW_PRECONDITION_FAILED: 6,
  ARTIFACT_INVALID: 6,
  INPUT_UNAVAILABLE: 6,
  EXECUTION_NOT_FOUND: 6,
  EXECUTION_NEEDS_INSPECTION: 6,
  EXECUTION_CONTEXT_REQUIRED: 6,
  EXECUTION_REVIEW_UNAVAILABLE: 6,
  EXECUTION_INPUTS_CHANGED: 6,
  CONTENT_UNAVAILABLE: 6,
  ROLE_INACTIVE: 6,
  MEMBER_INACTIVE: 6,

  NETWORK_UNAVAILABLE: 7,
  NETWORK_TIMEOUT: 7,
  RETRY_EXHAUSTED: 7,
  OFFLINE_UNAVAILABLE: 7,
  RATE_LIMITED: 7,

  CONTENT_INTEGRITY_FAILED: 8,
  LOCAL_MANAGED_FILE_MODIFIED: 8,
  PACKAGE_TAMPERED: 8,

  SERVER_ERROR: 9,
  PROTOCOL_INVALID: 9,
};

export type CliErrorOptions = {
  status?: number;
  details?: Record<string, unknown>;
  requestId?: string;
  exitCode?: ExitCode;
};

/** CLI 的统一错误：携带稳定错误码、退出码与可安全展示的 details。 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(code: string, message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
    this.exitCode = options.exitCode ?? exitCodeFor(code, options.status);
  }
}

export function exitCodeFor(code: string, status?: number): ExitCode {
  const known = CODE_EXIT[code];
  if (known !== undefined) return known;
  if (status === undefined) return 9;
  if (status === 401) return 3;
  if (status === 403) return 4;
  if (status === 409 || status === 412) return 5;
  if (status === 410) return 3;
  if (status === 429) return 7;
  if (status >= 500) return 9;
  if (status >= 400) return 2;
  return 9;
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return new CliError('INTERNAL_ERROR', error.message);
  return new CliError('INTERNAL_ERROR', '未知错误');
}

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
};

export function errorEnvelopeOf(error: CliError, requestId?: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId: requestId ?? error.requestId ?? '',
    },
  };
}
