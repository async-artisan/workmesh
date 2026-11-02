export type CredentialInput = {
  authorization?: string;
  sessionCookie?: string;
};

export function classifyCredential(
  input: CredentialInput,
): 'HUMAN_SESSION' | 'AGENT_BEARER' | 'NONE' | 'CONFLICT' {
  const hasBearer = /^Bearer\s+\S+$/.test(input.authorization ?? '');
  const hasSession = Boolean(input.sessionCookie);
  if (hasBearer && hasSession) return 'CONFLICT';
  if (hasBearer) return 'AGENT_BEARER';
  if (hasSession) return 'HUMAN_SESSION';
  return 'NONE';
}

export function assertHumanCredential(input: CredentialInput): void {
  const kind = classifyCredential(input);
  if (kind === 'CONFLICT') throw new Error('CREDENTIAL_CONFLICT');
  if (kind !== 'HUMAN_SESSION') throw new Error('HUMAN_SESSION_REQUIRED');
}
