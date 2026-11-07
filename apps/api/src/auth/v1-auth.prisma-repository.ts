import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { PrismaService } from '../prisma/prisma.service';
import { nextIdleExpiry, SESSION_IDLE_TIMEOUT_MS } from './v1-cookie-policy';
import type {
  V1AuthRepository,
  V1CliApproveInput,
  V1CliAuthorizationCreateInput,
  V1CliAuthorizationRecord,
  V1CliDenyInput,
  V1CredentialCreateInput,
  V1CredentialListRecord,
  V1CredentialRecord,
  V1PasswordRateReservation,
  V1RateWindowInput,
  V1SessionCreateInput,
  V1SessionRecord,
  V1UserRecord,
} from './v1-auth.repository';

const USER_SELECT = { id: true, isActive: true, authVersion: true } as const;

function mapCli(row: {
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
}): V1CliAuthorizationRecord {
  return {
    id: row.id,
    clientName: row.clientName,
    deviceCodeHash: row.deviceCodeHash,
    userCodeHash: row.userCodeHash,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: row.codeChallengeMethod,
    credentialSecretHash: row.credentialSecretHash,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    nextPollAt: row.nextPollAt,
    approvedUserId: row.approvedUserId,
    approvedProjectId: row.approvedProjectId,
    approvedRoleId: row.approvedRoleId,
    approvedScopes: row.approvedScopes,
    approvedExpiresInDays: row.approvedExpiresInDays,
    issuedCredentialId: row.issuedCredentialId,
    issuedAt: row.issuedAt,
    deniedAt: row.deniedAt,
  };
}

@Injectable()
export class V1AuthPrismaRepository implements V1AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSession(sessionId: string): Promise<V1SessionRecord | null> {
    const session = await this.prisma.webSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: USER_SELECT } },
    });
    if (!session) return null;
    return {
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      csrfTokenHash: session.csrfTokenHash,
      userAuthVersion: session.userAuthVersion,
      expiresAt: session.expiresAt,
      idleExpiresAt: session.idleExpiresAt,
      revokedAt: session.revokedAt,
      user: session.user,
    };
  }

  async findCredential(credentialId: string): Promise<V1CredentialRecord | null> {
    const credential = await this.prisma.agentCredential.findUnique({
      where: { id: credentialId },
      include: { user: { select: USER_SELECT } },
    });
    if (!credential) return null;
    return {
      id: credential.id,
      userId: credential.userId,
      projectId: credential.projectId,
      roleId: credential.roleId,
      name: credential.name,
      tokenHash: credential.tokenHash,
      scopes: credential.scopes,
      userAuthVersion: credential.userAuthVersion,
      expiresAt: credential.expiresAt,
      revokedAt: credential.revokedAt,
      user: credential.user,
    };
  }

  /**
   * 活动会话只向后延长 idle 截止，且不得越过绝对有效期 expiresAt。
   */
  async touchSession(sessionId: string, seenAt: Date): Promise<void> {
    const session = await this.prisma.webSession.findUnique({
      where: { id: sessionId },
      select: { idleExpiresAt: true, expiresAt: true },
    });
    if (!session) return;
    const idleExpiresAt = nextIdleExpiry({
      idleExpiresAt: session.idleExpiresAt,
      expiresAt: session.expiresAt,
      now: seenAt,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    });
    await this.prisma.webSession.update({
      where: { id: sessionId },
      data: { lastSeenAt: seenAt, idleExpiresAt },
    });
  }

  async findUserByEmail(email: string): Promise<V1UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUser(userId: string): Promise<V1UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async createUser(input: { email: string; passwordHash: string }): Promise<V1UserRecord> {
    return this.prisma.user.create({
      data: { email: input.email, passwordHash: input.passwordHash },
    });
  }

  async createSession(input: V1SessionCreateInput): Promise<void> {
    await this.prisma.webSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        csrfTokenHash: input.csrfTokenHash,
        userAuthVersion: input.userAuthVersion,
        idleExpiresAt: input.idleExpiresAt,
        expiresAt: input.expiresAt,
      },
    });
  }

  async updateSessionCsrf(sessionId: string, csrfTokenHash: string): Promise<void> {
    await this.prisma.webSession.update({
      where: { id: sessionId },
      data: { csrfTokenHash },
    });
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    await this.prisma.webSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async listCredentials(userId: string): Promise<V1CredentialListRecord[]> {
    const rows = await this.prisma.agentCredential.findMany({
      where: { userId },
      include: {
        user: { select: USER_SELECT },
        // 仅 CLI 签发的凭据有反向关联的授权请求；老凭据为 null。
        authorizationRequest: {
          select: {
            clientName: true,
            deviceName: true,
            devicePlatform: true,
            clientVersion: true,
            clientIp: true,
            approvedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      roleId: row.roleId,
      name: row.name,
      tokenHash: row.tokenHash,
      scopes: row.scopes,
      userAuthVersion: row.userAuthVersion,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: row.user,
      createdAt: row.createdAt,
      device: row.authorizationRequest
        ? {
            name: row.authorizationRequest.deviceName,
            platform: row.authorizationRequest.devicePlatform,
            clientVersion: row.authorizationRequest.clientVersion,
            ip: row.authorizationRequest.clientIp,
            clientName: row.authorizationRequest.clientName,
            authorizedAt: row.authorizationRequest.approvedAt,
          }
        : null,
    }));
  }

  async revokeCredential(credentialId: string, userId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.prisma.agentCredential.updateMany({
      where: { id: credentialId, userId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count === 1;
  }

  async createCredential(input: V1CredentialCreateInput): Promise<V1CredentialRecord> {
    const row = await this.prisma.agentCredential.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        roleId: input.roleId,
        name: input.name,
        tokenHash: input.tokenHash,
        scopes: input.scopes,
        userAuthVersion: input.userAuthVersion,
        expiresAt: input.expiresAt,
      },
      include: { user: { select: USER_SELECT } },
    });
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      roleId: row.roleId,
      name: row.name,
      tokenHash: row.tokenHash,
      scopes: row.scopes,
      userAuthVersion: row.userAuthVersion,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: row.user,
    };
  }

  async createCliAuthorization(
    input: V1CliAuthorizationCreateInput,
  ): Promise<V1CliAuthorizationRecord> {
    const row = await this.prisma.cliAuthorizationRequest.create({
      data: {
        clientName: input.clientName,
        deviceCodeHash: input.deviceCodeHash,
        userCodeHash: input.userCodeHash,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        credentialSecretHash: input.credentialSecretHash,
        expiresAt: input.expiresAt,
        deviceName: input.deviceName ?? null,
        devicePlatform: input.devicePlatform ?? null,
        clientVersion: input.clientVersion ?? null,
        clientIp: input.clientIp ?? null,
      },
    });
    return mapCli(row);
  }

  async findCliAuthorizationById(id: string): Promise<V1CliAuthorizationRecord | null> {
    const row = await this.prisma.cliAuthorizationRequest.findUnique({ where: { id } });
    return row ? mapCli(row) : null;
  }

  async findCliAuthorizationByDeviceCodeHash(
    hash: string,
  ): Promise<V1CliAuthorizationRecord | null> {
    const row = await this.prisma.cliAuthorizationRequest.findUnique({
      where: { deviceCodeHash: hash },
    });
    return row ? mapCli(row) : null;
  }

  async findCliAuthorizationByUserCodeHash(hash: string): Promise<V1CliAuthorizationRecord | null> {
    const row = await this.prisma.cliAuthorizationRequest.findUnique({
      where: { userCodeHash: hash },
    });
    return row ? mapCli(row) : null;
  }

  async recordCliAuthorizationView(input: {
    authorizationRequestId: string;
    webSessionId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.cliAuthorizationView.upsert({
      where: {
        authorizationRequestId_webSessionId: {
          authorizationRequestId: input.authorizationRequestId,
          webSessionId: input.webSessionId,
        },
      },
      create: {
        authorizationRequestId: input.authorizationRequestId,
        webSessionId: input.webSessionId,
        userId: input.userId,
        expiresAt: input.expiresAt,
      },
      update: { viewedAt: new Date(), expiresAt: input.expiresAt },
    });
  }

  async hasCliAuthorizationView(input: {
    authorizationRequestId: string;
    webSessionId: string;
    userId: string;
    now: Date;
  }): Promise<boolean> {
    const view = await this.prisma.cliAuthorizationView.findUnique({
      where: {
        authorizationRequestId_webSessionId: {
          authorizationRequestId: input.authorizationRequestId,
          webSessionId: input.webSessionId,
        },
      },
    });
    return Boolean(view && view.userId === input.userId && view.expiresAt > input.now);
  }

  /**
   * 批准只接受当前 PENDING、未过期且版本未变的请求；同时写入主体戳记。
   * 两个审批者并发时，只有一次条件更新会成功。
   */
  async approveCliAuthorization(
    input: V1CliApproveInput,
  ): Promise<V1CliAuthorizationRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.cliAuthorizationRequest.findUnique({ where: { id: input.id } });
      if (!request) return null;
      if (request.status !== 'PENDING' || request.expiresAt <= input.now) return null;
      if (request.version !== input.expectedVersion) return null;
      if (request.approvedUserId && request.approvedUserId !== input.userId) return null;
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user || !user.isActive) return null;
      const stamp = await tx.principalStamp.create({
        data: {
          kind: 'HUMAN',
          userId: input.userId,
          webSessionId: input.webSessionId,
          projectId: input.projectId,
          roleId: input.roleId,
          scopeSnapshot: input.scopes,
          userAuthVersion: user.authVersion,
          memberVersion: 1,
        },
      });
      const updated = await tx.cliAuthorizationRequest.updateMany({
        where: { id: input.id, status: 'PENDING', version: input.expectedVersion },
        data: {
          status: 'APPROVED',
          version: input.expectedVersion + 1,
          approvedUserId: input.userId,
          approvedProjectId: input.projectId,
          approvedRoleId: input.roleId,
          approvedScopes: input.scopes,
          approvedExpiresInDays: input.expiresInDays,
          approvedByStampId: stamp.id,
          approvedAt: input.now,
        },
      });
      if (updated.count !== 1) return null;
      const row = await tx.cliAuthorizationRequest.findUnique({ where: { id: input.id } });
      return row ? mapCli(row) : null;
    });
  }

  async denyCliAuthorization(input: V1CliDenyInput): Promise<V1CliAuthorizationRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.cliAuthorizationRequest.findUnique({ where: { id: input.id } });
      if (!request) return null;
      if (request.status !== 'PENDING' || request.expiresAt <= input.now) return null;
      if (request.version !== input.expectedVersion) return null;
      const stamp = await tx.principalStamp.create({
        data: {
          kind: 'HUMAN',
          userId: input.userId,
          webSessionId: input.webSessionId,
          userAuthVersion: 1,
          scopeSnapshot: [],
        },
      });
      const updated = await tx.cliAuthorizationRequest.updateMany({
        where: { id: input.id, status: 'PENDING', version: input.expectedVersion },
        data: {
          status: 'DENIED',
          version: input.expectedVersion + 1,
          deniedAt: input.now,
          deniedByStampId: stamp.id,
        },
      });
      if (updated.count !== 1) return null;
      const row = await tx.cliAuthorizationRequest.findUnique({ where: { id: input.id } });
      return row ? mapCli(row) : null;
    });
  }

  /**
   * APPROVED 在 poll 内只签发一次；已 ISSUED 的恢复窗口返回原凭据元数据而不新增凭据。
   */
  async markCliAuthorizationIssued(
    id: string,
    credentialId: string,
    now: Date,
  ): Promise<V1CliAuthorizationRecord | null> {
    const updated = await this.prisma.cliAuthorizationRequest.updateMany({
      where: { id, status: 'APPROVED', issuedCredentialId: null },
      data: {
        status: 'ISSUED',
        issuedCredentialId: credentialId,
        issuedAt: now,
        recoveryExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.prisma.cliAuthorizationRequest.findUnique({ where: { id } });
    return row ? mapCli(row) : null;
  }

  /**
   * 固定窗口计数：同一 kind/keyHash/windowStart 原子累加；跨实例并发不会丢计数。
   */
  async bumpRateWindow(input: V1RateWindowInput): Promise<number> {
    const windowStart = new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs);
    const expiresAt = new Date(windowStart.getTime() + input.windowMs);
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number }>>(Prisma.sql`
      INSERT INTO "workmesh_v1"."AuthRateWindow" ("id", "kind", "keyHash", "windowStart", "attempts", "expiresAt")
      VALUES (gen_random_uuid(), ${input.kind}, ${input.keyHash}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("kind", "keyHash", "windowStart")
      DO UPDATE SET "attempts" = "AuthRateWindow"."attempts" + 1
      RETURNING "attempts"
    `);
    return rows[0]?.attempts ?? 1;
  }

  /** Failed and in-flight password checks share a bounded, atomically reserved budget. */
  async reservePasswordRateWindow(
    input: V1RateWindowInput & { limit: number },
  ): Promise<V1PasswordRateReservation | null> {
    const windowStart = new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs);
    const expiresAt = new Date(windowStart.getTime() + input.windowMs);
    const rows = await this.prisma.$queryRaw<Array<{ windowStart: Date }>>(Prisma.sql`
      INSERT INTO "workmesh_v1"."AuthRateWindow" ("id", "kind", "keyHash", "windowStart", "attempts", "expiresAt")
      VALUES (gen_random_uuid(), ${input.kind}, ${input.keyHash}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("kind", "keyHash", "windowStart")
      DO UPDATE SET "attempts" = "AuthRateWindow"."attempts" + 1
      WHERE "AuthRateWindow"."attempts" < ${input.limit}
      RETURNING "windowStart"
    `);
    return rows[0]
      ? { kind: input.kind, keyHash: input.keyHash, windowStart: rows[0].windowStart }
      : null;
  }

  /** Only release this successful check; never erase concurrent failures or a newer window. */
  async releasePasswordRateWindow(reservation: V1PasswordRateReservation): Promise<void> {
    await this.prisma.authRateWindow.updateMany({
      where: { ...reservation, attempts: { gt: 0 } },
      data: { attempts: { decrement: 1 } },
    });
  }
}
