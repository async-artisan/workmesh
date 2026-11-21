import { parseJsonStrict, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

type CredentialBinding = {
  projectId: string;
  projectRepositoryId: string;
  providerRepositoryId: string;
  tokenEnvironmentVariable: string;
};

/** Explicit project/repository mapping; no default token and no client supplied secrets. */
export function resolveActionsCredential(
  identity: Omit<CredentialBinding, 'tokenEnvironmentVariable'>,
  env: Record<string, string | undefined> = process.env,
): string {
  const unavailable = () =>
    new WorkmeshError(
      V1_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      'ACTIONS_READ_CREDENTIAL_UNAVAILABLE',
      { projectRepositoryId: identity.projectRepositoryId },
      503,
    );
  const raw = env.WORKMESH_GITHUB_ACTIONS_CREDENTIALS_JSON;
  if (!raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw unavailable();
  let bindings: unknown;
  try {
    bindings = parseJsonStrict(raw);
  } catch {
    throw unavailable();
  }
  if (!Array.isArray(bindings) || bindings.length > 100) throw unavailable();
  const seen = new Set<string>();
  let selected: CredentialBinding | undefined;
  for (const binding of bindings) {
    if (
      !binding ||
      typeof binding !== 'object' ||
      Array.isArray(binding) ||
      Object.keys(binding).sort().join(',') !==
        'projectId,projectRepositoryId,providerRepositoryId,tokenEnvironmentVariable' ||
      !['projectId', 'projectRepositoryId', 'providerRepositoryId'].every(
        (key) => typeof binding[key] === 'string' && binding[key].length > 0,
      ) ||
      typeof binding.tokenEnvironmentVariable !== 'string' ||
      !/^WORKMESH_GITHUB_ACTIONS_TOKEN_[A-Z0-9_]+$/.test(binding.tokenEnvironmentVariable)
    )
      throw unavailable();
    const key = `${binding.projectId}:${binding.projectRepositoryId}`;
    if (seen.has(key)) throw unavailable();
    seen.add(key);
    if (
      binding.projectId === identity.projectId &&
      binding.projectRepositoryId === identity.projectRepositoryId &&
      binding.providerRepositoryId === identity.providerRepositoryId
    )
      selected = binding as CredentialBinding;
  }
  const token = selected && env[selected.tokenEnvironmentVariable];
  if (!token || !token.trim() || /[\r\n]/.test(token)) throw unavailable();
  return token;
}
