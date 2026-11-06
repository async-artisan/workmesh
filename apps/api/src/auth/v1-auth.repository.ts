export type V1AuthUser = { id: string; isActive: boolean; authVersion: number };

export type V1UserRecord = V1AuthUser & { email: string; passwordHash: string };

export type V1SessionRecord = {
  id: string;
  userId: string | null;
  tokenHash: string;
  csrfTokenHash: string;
  userAuthVersion: number | null;
  expiresAt: Date;
  idleExpiresAt: Date;
  revokedAt: Date | null;
  user: V1AuthUser | null;
};

export type V1CredentialRecord = {
  id: string;
  userId: string;
  projectId: string;
  roleId: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  userAuthVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
  user: V1AuthUser;
};

/** 凭据关联的 CLI 授权请求上的设备元数据；老凭据没有关联行时为 null。 */
export type V1CredentialDeviceRecord = {
  name: string | null;
  platform: string | null;
  clientVersion: string | null;
  ip: string | null;
  clientName: string | null;
  authorizedAt: Date | null;
};

/** 用户中心凭据列表项：在基础凭据字段上附加创建时间与设备元数据。 */
export type V1CredentialListRecord = V1CredentialRecord & {
  createdAt: Date;
  device: V1CredentialDeviceRecord | null;
};

export type V1SessionCreateInput = {
  id: string;
  userId: string | null;
  tokenHash: string;
  csrfTokenHash: string;
  userAuthVersion: number | null;
  idleExpiresAt: Date;
  expiresAt: Date;
};

export type V1CredentialCreateInput = {
  userId: string;
  projectId: string;
  roleId: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  userAuthVersion: number;
  expiresAt: Date;
};

export type V1CliAuthorizationRecord = {
  id: string;
  clientName: string;
  deviceCodeHash: string;
  userCodeHash: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  credentialSecretHash: string;
  status: string;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  nextPollAt: Date;
  approvedUserId: string | null;
  approvedProjectId: string | null;
  approvedRoleId: string | null;
  approvedScopes: string[];
  approvedExpiresInDays: number | null;
  issuedCredentialId: string | null;
  issuedAt: Date | null;
  deniedAt: Date | null;
};

export type V1CliAuthorizationCreateInput = {
  clientName: string;
  deviceCodeHash: string;
  userCodeHash: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  credentialSecretHash: string;
  expiresAt: Date;
  deviceName?: string;
  devicePlatform?: string;
  clientVersion?: string;
  clientIp?: string;
};

export type V1CliApproveInput = {
  id: string;
  userId: string;
  webSessionId: string;
  expectedVersion: number;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresInDays: number;
  now: Date;
};

export type V1CliDenyInput = {
  id: string;
  userId: string;
  webSessionId: string;
  expectedVersion: number;
  now: Date;
};

export type V1RateWindowInput = {
  kind: string;
  keyHash: string;
  now: Date;
  windowMs: number;
};

export interface V1AuthRepository {
  findSession(sessionId: string): Promise<V1SessionRecord | null>;
  findCredential(credentialId: string): Promise<V1CredentialRecord | null>;
  touchSession(sessionId: string, seenAt: Date): Promise<void>;
  findUserByEmail(email: string): Promise<V1UserRecord | null>;
  findUser(userId: string): Promise<V1UserRecord | null>;
  createUser(input: { email: string; passwordHash: string }): Promise<V1UserRecord>;
  createSession(input: V1SessionCreateInput): Promise<void>;
  updateSessionCsrf(sessionId: string, csrfTokenHash: string): Promise<void>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  listCredentials(userId: string): Promise<V1CredentialListRecord[]>;
  revokeCredential(credentialId: string, userId: string, revokedAt: Date): Promise<boolean>;
  createCredential(input: V1CredentialCreateInput): Promise<V1CredentialRecord>;
  createCliAuthorization(input: V1CliAuthorizationCreateInput): Promise<V1CliAuthorizationRecord>;
  findCliAuthorizationById(id: string): Promise<V1CliAuthorizationRecord | null>;
  findCliAuthorizationByDeviceCodeHash(hash: string): Promise<V1CliAuthorizationRecord | null>;
  findCliAuthorizationByUserCodeHash(hash: string): Promise<V1CliAuthorizationRecord | null>;
  recordCliAuthorizationView(input: {
    authorizationRequestId: string;
    webSessionId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  hasCliAuthorizationView(input: {
    authorizationRequestId: string;
    webSessionId: string;
    userId: string;
    now: Date;
  }): Promise<boolean>;
  approveCliAuthorization(input: V1CliApproveInput): Promise<V1CliAuthorizationRecord | null>;
  denyCliAuthorization(input: V1CliDenyInput): Promise<V1CliAuthorizationRecord | null>;
  markCliAuthorizationIssued(
    id: string,
    credentialId: string,
    now: Date,
  ): Promise<V1CliAuthorizationRecord | null>;
  bumpRateWindow(input: V1RateWindowInput): Promise<number>;
}

export function parseAgentBearerToken(
  value: string,
): { credentialId: string; secret: string } | null {
  const match = /^wm_a1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { credentialId: match[1], secret: match[2] } : null;
}
