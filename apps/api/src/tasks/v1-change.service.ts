import { Inject, Injectable } from '@nestjs/common';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import { principalScopeKey, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import {
  V1_CHANGE_REPOSITORY,
  type V1AckInput,
  type V1ChangeEventSnapshot,
  type V1ChangeListQuery,
  type V1ChangeRecipientSnapshot,
  type V1RecordChangeInput,
  type V1RecordChangeResult,
} from './v1-change.repository';

export interface V1AckServiceInput {
  idempotencyKey: string;
  expectedVersion?: number;
  method: string;
  route: string;
  requestId: string;
  now: Date;
  operationId: string;
  body: Record<string, unknown>;
}

export interface V1AckServiceResult {
  recipient: V1ChangeRecipientSnapshot;
  replayed: boolean;
}

export interface V1ListServiceInput {
  projectId: string;
  ackedOnly?: boolean;
  cursor?: string;
  limit: number;
}

export interface V1ListServiceResult {
  items: V1ChangeRecipientSnapshot[];
  nextCursor: string | null;
}

export interface V1RecordChangeServiceInput {
  projectId: string;
  requirementId?: string | null;
  sourceKind: string;
  sourceId: string;
  changedFields: string[];
  targets: unknown;
  recipients: { userId: string; roleId?: string | null }[];
  idempotencyKey: string;
  method: string;
  route: string;
  requestId: string;
  now: Date;
  operationId: string;
  body: Record<string, unknown>;
}

export interface V1RecordChangeServiceResult {
  event: V1ChangeEventSnapshot;
  recipients: V1ChangeRecipientSnapshot[];
  replayed: boolean;
}

@Injectable()
export class V1ChangeService {
  constructor(
    @Inject(V1_CHANGE_REPOSITORY) private readonly repository: import('./v1-change.repository').V1ChangeRepository,
    private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  /**
   * 收件人确认收到变更。并发确认不会丢失：乐观锁 + 幂等重放。
   * 仅收件人本人才可确认（HUMAN 必须 userId 匹配；AGENT 同样按 userId 匹配，不匹配则不泄露存在性）。
   */
  async ack(principal: Principal, recipientId: string, input: V1AckServiceInput): Promise<V1AckServiceResult> {
    const recipient = await this.repository.findRecipient(recipientId);
    if (!recipient) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'CHANGE_RECIPIENT_NOT_FOUND', { recipientId }, 404);

    // 授权：必须是该项目活动成员；Agent 受项目/角色边界约束。
    await this.authorization.resolveProjectContext(principal, recipient.projectId);
    await this.authorization.requireScope(principal, recipient.projectId, 'change:ack');

    // 仅收件人本人可确认；不匹配时按 404 处理，不泄露存在性。
    if (principal.userId !== recipient.userId)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'CHANGE_RECIPIENT_NOT_FOUND', { recipientId }, 404);

    const projectScopeKey = `project:${recipient.projectId}`;
    const principalScopeKeyVal = principalScopeKey(principal);
    const requestDigest = requestDigestOf({ method: input.method, route: input.route, body: input.body });

    const existing = await this.operations.findOperation({ projectScopeKey, principalScopeKey: principalScopeKeyVal, key: input.idempotencyKey });
    if (existing) {
      assertReplayable(existing, { method: input.method, route: input.route, digest: requestDigest });
      const current = await this.repository.findRecipient(recipientId);
      return { recipient: current!, replayed: true };
    }

    const ackInput: V1AckInput = {
      id: recipientId,
      expectedVersion: input.expectedVersion,
      operation: {
        id: input.operationId,
        projectScopeKey,
        principalScopeKey: principalScopeKeyVal,
        key: input.idempotencyKey,
        method: input.method,
        route: input.route,
        requestDigest,
        now: input.now,
      },
    };

    const result = await this.repository.ack(ackInput);
    return { recipient: result.recipient, replayed: false };
  }

  /** 列出当前主体作为收件人的变更通知；keyset 分页，>100 不丢。 */
  async listRecipients(principal: Principal, input: V1ListServiceInput): Promise<V1ListServiceResult> {
    await this.authorization.resolveProjectContext(principal, input.projectId);
    await this.authorization.requireScope(principal, input.projectId, 'change:read');

    const query: V1ChangeListQuery = {
      userId: principal.userId,
      projectId: input.projectId,
      ackedOnly: input.ackedOnly,
      cursor: input.cursor,
      limit: input.limit,
    };
    const result = await this.repository.listRecipients(query);
    return { items: result.items, nextCursor: result.nextCursor };
  }

  /** 记录一次变更事件并通知相关收件人（由 T03 发布流程在同一步骤调用）。 */
  async recordChange(principal: Principal, input: V1RecordChangeServiceInput): Promise<V1RecordChangeServiceResult> {
    await this.authorization.resolveProjectContext(principal, input.projectId);

    const projectScopeKey = `project:${input.projectId}`;
    const principalScopeKeyValue = principalScopeKey(principal);
    const requestDigest = requestDigestOf({ method: input.method, route: input.route, body: input.body });

    const existing = await this.operations.findOperation({ projectScopeKey, principalScopeKey: principalScopeKeyValue, key: input.idempotencyKey });
    if (existing) {
      assertReplayable(existing, { method: input.method, route: input.route, digest: requestDigest });
      const eventId = String(existing.resultRefs.eventId ?? '');
      const event = await this.repository.findEvent(eventId);
      if (event)
        return { event, recipients: event.recipients, replayed: true } satisfies V1RecordChangeServiceResult;
    }

    const repoInput: V1RecordChangeInput = {
      projectId: input.projectId,
      requirementId: input.requirementId ?? null,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      changedFields: input.changedFields,
      targets: input.targets,
      recipients: input.recipients,
      operation: {
        id: input.operationId,
        projectScopeKey,
        principalScopeKey: principalScopeKeyValue,
        key: input.idempotencyKey,
        method: input.method,
        route: input.route,
        requestDigest,
        now: input.now,
      },
    };
    const result = await this.repository.recordChange(repoInput);
    return { event: result.event, recipients: result.recipients, replayed: false } satisfies V1RecordChangeServiceResult;
  }
}
