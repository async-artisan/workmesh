export const PROTOCOL_VERSION = '1.0' as const;
export const API_ROOT = '/api/v1' as const;

export type ApiSuccess<T> = { data: T; meta: { requestId: string } };
export type ApiError = {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId: string };
};

export type PrincipalKind = 'HUMAN' | 'AGENT';
export type Scope =
  | 'project:read'
  | 'workflow:read'
  | 'workflow:propose'
  | 'requirement:read'
  | 'requirement:propose'
  | 'clarification:write'
  | 'knowledge:read'
  | 'knowledge:propose'
  | 'task:read'
  | 'task:claim'
  | 'task:release'
  | 'task:deliver'
  | 'context:read'
  | 'context:create'
  | 'review:read'
  | 'review:request'
  | 'change:read'
  | 'change:ack'
  | 'integrations:receive'
  | 'integrations:prepare';

export const DEFAULT_READ_SCOPES: readonly Scope[] = [
  'project:read',
  'workflow:read',
  'requirement:read',
  'knowledge:read',
  'task:read',
  'context:read',
  'review:read',
  'change:read',
];
