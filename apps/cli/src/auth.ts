import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CliError } from './errors';
import { V1Client, type FetchLike, type V1Response } from './client';
import type { Platform } from './platform';
import { verificationUrl } from './platform';
import {
  saveCredential,
  savePendingProof,
  removePendingProof,
  type AgentCredential,
} from './credential-store';

export type DeviceLoginOptions = {
  platform: Platform;
  configHome: string;
  projectId: string;
  roleKey: string;
  clientName?: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onNotice: (text: string) => void;
  onPrompt: (prompt: { url: string; userCode: string; expiresAt: string }) => void;
  timeoutMs?: number;
};

export type DeviceLoginResult = {
  credential: AgentCredential;
  credentialPath: string;
  requestId: string;
};

type DeviceAuthorization = {
  authorizationId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
};

type CredentialView = {
  credentialId: string;
  userId: string;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresAt: string;
};

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function base64url(value: Buffer): string {
  return value.toString('base64url');
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', message);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new CliError('PROTOCOL_INVALID', message);
  return value;
}

/** PKCE S256：verifier 与 secret 都是 32 字节随机值，服务端只收 challenge 与 secret hash。 */
export function createProof(): {
  codeVerifier: string;
  codeChallenge: string;
  credentialSecret: string;
  credentialSecretHash: string;
} {
  const codeVerifier = base64url(randomBytes(32));
  const credentialSecret = base64url(randomBytes(32));
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const credentialSecretHash = createHash('sha256').update(credentialSecret, 'ascii').digest('hex');
  return { codeVerifier, codeChallenge, credentialSecret, credentialSecretHash };
}

function readCredentialView(value: unknown): CredentialView {
  const record = asRecord(value, '授权响应缺少 credential');
  const credentialId = readString(record, 'credentialId', '授权响应 credentialId 非法');
  const userId = readString(record, 'userId', '授权响应 userId 非法');
  const projectId = readString(record, 'projectId', '授权响应 projectId 非法');
  const roleId = readString(record, 'roleId', '授权响应 roleId 非法');
  if (!UUID.test(credentialId) || !UUID.test(userId) || !UUID.test(projectId) || !UUID.test(roleId))
    throw new CliError('PROTOCOL_INVALID', '授权响应中的 ID 不是 UUID');
  const scopes = record.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.some((scope) => typeof scope !== 'string')
  )
    throw new CliError('PROTOCOL_INVALID', '授权响应 scopes 非法');
  const expiresAt = readString(record, 'expiresAt', '授权响应 expiresAt 非法');
  if (Number.isNaN(Date.parse(expiresAt)))
    throw new CliError('PROTOCOL_INVALID', '授权响应 expiresAt 非法');
  return { credentialId, userId, projectId, roleId, scopes: scopes as string[], expiresAt };
}

/**
 * 浏览器设备授权：本地生成 proof，展示 userCode 与固定授权页，
 * 每 interval 秒轮询；批准只发生在 Web，CLI 不接收密码或 HUMAN token。
 */
export async function deviceLogin(options: DeviceLoginOptions): Promise<DeviceLoginResult> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const proof = createProof();
  const pendingId = randomUUID();
  await savePendingProof(options.configHome, pendingId, {
    version: '1.0',
    authorizationId: null,
    deviceCode: null,
    codeVerifier: proof.codeVerifier,
    credentialSecret: proof.credentialSecret,
    createdAt: new Date(now()).toISOString(),
  });

  const anonymous = new V1Client({
    platform: options.platform,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
  });

  const created = await anonymous.request<Record<string, unknown>>('POST', '/auth/cli-authorizations', {
    body: {
      clientName: (options.clientName ?? 'workmesh-cli').slice(0, 80),
      codeChallenge: proof.codeChallenge,
      codeChallengeMethod: 'S256',
      credentialSecretHash: proof.credentialSecretHash,
    },
    idempotent: false,
  });

  const authorization = asRecord(created.data, '创建设备授权响应非法');
  const device: DeviceAuthorization = {
    authorizationId: readString(authorization, 'authorizationId', '授权响应 authorizationId 非法'),
    deviceCode: readString(authorization, 'deviceCode', '授权响应 deviceCode 非法'),
    userCode: readString(authorization, 'userCode', '授权响应 userCode 非法'),
    verificationUri: readString(authorization, 'verificationUri', '授权响应 verificationUri 非法'),
    expiresAt: readString(authorization, 'expiresAt', '授权响应 expiresAt 非法'),
    intervalSeconds: Number(authorization.intervalSeconds ?? 5),
  };
  if (!UUID.test(device.authorizationId))
    throw new CliError('PROTOCOL_INVALID', 'authorizationId 不是 UUID');
  if (Number.isNaN(Date.parse(device.expiresAt)))
    throw new CliError('PROTOCOL_INVALID', '授权响应 expiresAt 不是时间');
  if (!Number.isFinite(device.intervalSeconds) || device.intervalSeconds < 1)
    throw new CliError('PROTOCOL_INVALID', '授权响应 intervalSeconds 非法');

  await savePendingProof(options.configHome, pendingId, {
    version: '1.0',
    authorizationId: device.authorizationId,
    deviceCode: device.deviceCode,
    codeVerifier: proof.codeVerifier,
    credentialSecret: proof.credentialSecret,
    createdAt: new Date(now()).toISOString(),
  });

  const url = verificationUrl(options.platform, device.verificationUri);
  options.onPrompt({ url, userCode: device.userCode, expiresAt: device.expiresAt });
  options.onNotice('请在浏览器完成授权；CLI 不会索取密码，也不会接收 HUMAN 会话。');

  const deadline = Math.min(Date.parse(device.expiresAt), now() + timeoutMs);
  let intervalMs = device.intervalSeconds * 1000;
  let lastNetworkError: CliError | undefined;

  for (;;) {
    if (now() >= deadline) {
      if (lastNetworkError) throw lastNetworkError;
      throw new CliError('AUTHORIZATION_EXPIRED', '授权已过期，请重新运行 workmesh auth login');
    }
    let polled: V1Response<Record<string, unknown>>;
    try {
      polled = await anonymous.request<Record<string, unknown>>(
        'POST',
        '/auth/cli-authorizations/poll',
        {
          body: {
            authorizationId: device.authorizationId,
            deviceCode: device.deviceCode,
            codeVerifier: proof.codeVerifier,
          },
          idempotent: false,
        },
      );
    } catch (error) {
      if (error instanceof CliError && error.code === 'AUTHORIZATION_DENIED')
        throw new CliError('AUTHORIZATION_DENIED', '授权已被拒绝；如仍需要访问，请重新发起授权', {
          status: 403,
        });
      if (error instanceof CliError && error.code === 'AUTHORIZATION_EXPIRED')
        throw new CliError('AUTHORIZATION_EXPIRED', '授权已过期，请重新运行 workmesh auth login', {
          status: 410,
        });
      if (
        error instanceof CliError &&
        (error.code === 'AUTHORIZATION_SLOW_DOWN' || error.code === 'RATE_LIMITED')
      ) {
        intervalMs = Math.max(intervalMs, 10_000);
        await sleep(Math.min(intervalMs, Math.max(1, deadline - now())));
        continue;
      }
      if (
        error instanceof CliError &&
        (error.code === 'NETWORK_UNAVAILABLE' || error.code === 'NETWORK_TIMEOUT')
      ) {
        lastNetworkError = error;
        await sleep(Math.min(intervalMs, Math.max(1, deadline - now())));
        continue;
      }
      throw error;
    }

    const poll = asRecord(polled.data, '轮询响应非法');
    const status = poll.status;
    if (status === 'PENDING') {
      const interval = Number(poll.intervalSeconds ?? device.intervalSeconds);
      if (Number.isFinite(interval) && interval >= 1) intervalMs = interval * 1000;
      await sleep(Math.min(intervalMs, Math.max(1, deadline - now())));
      continue;
    }
    if (status !== 'ISSUED') throw new CliError('PROTOCOL_INVALID', '轮询响应状态非法');

    const view = readCredentialView(poll.credential);
    const roleKey = view.projectId === options.projectId ? options.roleKey : '';
    if (view.projectId !== options.projectId)
      options.onNotice('浏览器批准的项目与当前工作区不同，该凭据不会用于当前工作区命令。');

    const credential: AgentCredential = {
      version: '1.0',
      origin: options.platform.origin,
      apiBasePath: options.platform.apiBasePath,
      userId: view.userId,
      credentialId: view.credentialId,
      secret: proof.credentialSecret,
      projectId: view.projectId,
      roleId: view.roleId,
      roleKey,
      scopes: view.scopes,
      createdAt: new Date(now()).toISOString(),
      expiresAt: view.expiresAt,
    };
    const credentialPath = await saveCredential(options.configHome, credential);
    await removePendingProof(options.configHome, pendingId);
    return { credential, credentialPath, requestId: polled.requestId };
  }
}
