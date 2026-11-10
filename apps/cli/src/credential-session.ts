import { V1Client, type FetchLike } from './client';
import { bearerOf, findCredential, type AgentCredential } from './credential-store';
import { CliError } from './errors';
import type { Platform } from './platform';

export type CredentialSessionOptions = {
  platform: Platform;
  configHome: string;
  projectId: string;
  roleKey: string;
  fetch?: FetchLike;
  now?: number;
  requiredScopes?: string[];
};

/** Reuse is read-only and requires a matching local record plus a live server check. */
export async function findReusableCredential(
  options: CredentialSessionOptions,
): Promise<AgentCredential | null> {
  let credential: AgentCredential;
  try {
    credential = await findCredential(
      options.configHome,
      { ...options.platform, projectId: options.projectId, roleKey: options.roleKey },
      options.now,
    );
  } catch (error) {
    if (error instanceof CliError && error.code === 'AUTH_REQUIRED') return null;
    throw error;
  }
  if (!Number.isFinite(Date.parse(credential.expiresAt))) return null;
  const requiredScopes = options.requiredScopes ?? ['task:read', 'context:read'];
  if (requiredScopes.some((scope) => !credential.scopes.includes(scope))) return null;

  const client = new V1Client({
    platform: options.platform,
    bearer: bearerOf(credential),
    fetch: options.fetch,
  });
  let data: { principal?: Record<string, unknown> };
  try {
    ({ data } = await client.request<typeof data>('GET', '/auth/me'));
  } catch (error) {
    if (
      error instanceof CliError &&
      (error.status === 401 ||
        ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'CREDENTIAL_REVOKED'].includes(
          error.code,
        ))
    )
      return null;
    // A transport or server failure is not evidence that a new authorization is needed.
    throw error;
  }
  const principal = data?.principal;
  const scopes = principal?.scopes;
  if (
    !principal ||
    principal.kind !== 'AGENT' ||
    principal.agentCredentialId !== credential.credentialId ||
    principal.projectId !== options.projectId ||
    !Array.isArray(principal.roleIds) ||
    !principal.roleIds.includes(credential.roleId) ||
    !Array.isArray(scopes) ||
    requiredScopes.some((scope) => !scopes.includes(scope))
  )
    return null;
  return credential;
}
