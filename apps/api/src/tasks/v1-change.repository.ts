import type { Principal } from '@workmesh/shared';
import type { V1OperationRecord } from '../common/v1-idempotency';

/** 变更收件人快照（只读派生自 ChangeRecipient 行）。 */
export interface V1ChangeRecipientSnapshot {
  id: string;
  projectId: string;
  eventId: string;
  userId: string;
  roleId: string | null;
  version: number;
  ackedAt: string | null;
  createdAt: string;
}

/** 变更事件快照（recordChange 创建后返回）。 */
export interface V1ChangeEventSnapshot {
  id: string;
  projectId: string;
  requirementId: string | null;
  sourceKind: string;
  sourceId: string;
  changedFields: string[];
  targets: unknown;
  createdAt: string;
}

export interface V1OperationInput {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
  now: Date;
}

export interface V1AckInput {
  id: string;
  operation: V1OperationInput;
  /** 乐观并发版本；提供且与当前不一致时返回 VERSION_CONFLICT。 */
  expectedVersion?: number;
}

export interface V1AckResult {
  recipient: V1ChangeRecipientSnapshot;
  idempotency: V1OperationRecord;
}

export interface V1ChangeListQuery {
  userId: string;
  projectId?: string;
  ackedOnly?: boolean;
  /** 上一页最后一条的 id（keyset 游标），稳定排序 (createdAt DESC, id DESC)。 */
  cursor?: string;
  limit: number;
}

export interface V1ChangeListResult {
  items: V1ChangeRecipientSnapshot[];
  nextCursor: string | null;
}

export interface V1RecordChangeRecipient {
  userId: string;
  roleId?: string | null;
}

export interface V1RecordChangeInput {
  projectId: string;
  requirementId?: string | null;
  sourceKind: string;
  sourceId: string;
  changedFields: string[];
  targets: unknown;
  recipients: V1RecordChangeRecipient[];
  operation: V1OperationInput;
}

export interface V1RecordChangeResult {
  event: V1ChangeEventSnapshot;
  recipients: V1ChangeRecipientSnapshot[];
  idempotency: V1OperationRecord;
}

export interface V1ChangeEventWithRecipients extends V1ChangeEventSnapshot {
  recipients: V1ChangeRecipientSnapshot[];
}

export const V1_CHANGE_REPOSITORY = Symbol('V1_CHANGE_REPOSITORY');

export interface V1ChangeRepository {
  /** 创建变更事件并连带收件人；由 T03 发布流程在同一步骤调用。 */
  recordChange(input: V1RecordChangeInput): Promise<V1RecordChangeResult>;
  findEvent(id: string): Promise<V1ChangeEventWithRecipients | null>;
  findRecipient(id: string): Promise<V1ChangeRecipientSnapshot | null>;
  /** 收件人确认收到变更；乐观并发 + 幂等重放。 */
  ack(input: V1AckInput): Promise<V1AckResult>;
  /** 按用户列出收件人，keyset 分页，>100 不丢。 */
  listRecipients(query: V1ChangeListQuery): Promise<V1ChangeListResult>;
}

export type { Principal };
