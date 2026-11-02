import { apiRequest, setCsrfToken } from './client';
import { useAuthStore } from '../store/auth';

export interface SessionView {
  authenticated: boolean;
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  csrfToken: string;
  user?: { id: string; email: string };
}

/** 会话引导：每次登录/注册/启动都重新读取 cookie 会话与 CSRF，不把凭据写进存储。 */
export async function bootstrapSession(): Promise<SessionView> {
  const view = await apiRequest<SessionView>('/auth/session');
  setCsrfToken(view.csrfToken);
  if (view.authenticated && view.user) useAuthStore.getState().setSession(view.user);
  else useAuthStore.getState().clearAuth();
  return view;
}

export interface CliAuthorizationView {
  authorizationId: string;
  clientName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  version: number;
}

export interface ActionBindingInput {
  action: string;
  projectId: string | null;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  roleSlot: { roleId: string; approvalSlotId: string | null } | null;
  payload: Record<string, unknown>;
}

export interface ActionPreviewView {
  binding: ActionBindingInput;
  actionDigest: string;
  display: {
    action: string;
    targetType: string;
    targetId: string;
    expectedVersion: number;
    projectId: string | null;
    roleSlot: { roleId: string; approvalSlotId: string | null } | null;
  };
}

export interface ConfirmationTicketView {
  ticketId: string;
  ticketSecret: string;
  expiresAt: string;
  actionDigest: string;
}

export const authApi = {
  login: async (data: { email: string; password: string }) => {
    await apiRequest('/auth/login', { method: 'POST', body: data });
    return bootstrapSession();
  },
  register: async (data: { email: string; password: string; name?: string }) => {
    await apiRequest('/auth/register', { method: 'POST', body: data });
    return bootstrapSession();
  },
  logout: async () => {
    await apiRequest('/auth/logout', { method: 'POST', body: {} });
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
  },
  me: () => apiRequest<Record<string, unknown>>('/auth/me'),
  credentials: () =>
    apiRequest<
      Array<{
        id: string;
        name: string;
        projectId: string;
        roleId: string;
        scopes: string[];
        expiresAt: string;
        revokedAt: string | null;
      }>
    >('/auth/credentials'),
  revokeCredential: (credentialId: string) =>
    apiRequest<{ revoked: true }>(`/auth/credentials/${encodeURIComponent(credentialId)}`, {
      method: 'DELETE',
      idempotencyKey: 'auto',
    }),
  cliLookup: (userCode: string) =>
    apiRequest<CliAuthorizationView>('/auth/cli-authorizations/lookup', {
      method: 'POST',
      body: { userCode },
    }),
  cliApprove: (input: {
    authorizationId: string;
    expectedVersion: number;
    projectId: string;
    roleId: string;
    scopes: string[];
    expiresInDays: number;
  }) => {
    const { authorizationId, ...body } = input;
    return apiRequest<{
      authorizationId: string;
      status: string;
      version: number;
      expiresAt: string;
    }>(`/auth/cli-authorizations/${encodeURIComponent(authorizationId)}/approve`, {
      method: 'POST',
      body,
    });
  },
  cliDeny: (authorizationId: string, expectedVersion: number) =>
    apiRequest<{ authorizationId: string; status: string; version: number }>(
      `/auth/cli-authorizations/${encodeURIComponent(authorizationId)}/deny`,
      { method: 'POST', body: { expectedVersion } },
    ),
  preview: (binding: ActionBindingInput) =>
    apiRequest<ActionPreviewView>('/auth/action-previews', { method: 'POST', body: binding }),
  issueTicket: (binding: ActionBindingInput, actionDigest: string, password: string) =>
    apiRequest<ConfirmationTicketView>('/auth/confirmation-tickets', {
      method: 'POST',
      body: { ...binding, actionDigest, password },
    }),
};
