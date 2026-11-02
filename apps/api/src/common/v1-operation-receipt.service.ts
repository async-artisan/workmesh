import { Inject, Injectable } from '@nestjs/common';
import {
  accountScopeKey,
  principalScopeKey,
  projectScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import {
  V1_OPERATION_RECEIPT_REPOSITORY,
  type V1OperationReceiptRecord,
  type V1OperationReceiptRepository,
} from './v1-operation-receipt.repository';

export type V1OperationReceiptView = {
  operationKey: string;
  requestDigest: string;
  status: 'COMMITTED';
  resultRefs: Record<string, unknown>;
  committedAt: Date;
  method: string;
  route: string;
  projectId: string | null;
};

const OPERATION_KEY_MAX = 200;

function invalidOperationKey(operationKey: string): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'INVALID_OPERATION_KEY', { operationKey }, 400);
}

function operationNotFound(): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'OPERATION_NOT_FOUND', undefined, 404);
}

/**
 * 操作收据（只读）。
 *
 * 只有原主体（HUMAN 按 user、AGENT 按具体凭据）能读取自己的收据；
 * Agent 的原授权用户可以当前 HUMAN 身份读取该 Agent 的已提交收据，且项目必须仍可见。
 * 其他 key、未提交操作或跨主体尝试统一 404，不泄露存在性。
 */
@Injectable()
export class V1OperationReceiptService {
  constructor(
    @Inject(V1_OPERATION_RECEIPT_REPOSITORY) private readonly repository: V1OperationReceiptRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  async getReceipt(principal: Principal, operationKey: string, projectId: string | null): Promise<V1OperationReceiptView> {
    if (operationKey.length === 0 || operationKey.length > OPERATION_KEY_MAX) throw invalidOperationKey(operationKey);

    const expectedProjectId = projectId ?? null;
    const scopeKey = projectId ? projectScopeKey(projectId) : accountScopeKey(principal.userId);
    if (projectId) await this.authorization.resolveProjectContext(principal, projectId);

    const records = await this.repository.findOperations({ projectScopeKey: scopeKey, key: operationKey });
    const record = await this.selectRecord(principal, records);
    if (!record || !record.committedAt) throw operationNotFound();
    if (record.projectId !== expectedProjectId) throw operationNotFound();

    return {
      operationKey: record.key,
      requestDigest: record.requestDigest,
      status: 'COMMITTED',
      resultRefs: record.resultRefs,
      committedAt: record.committedAt,
      method: record.method,
      route: record.route,
      projectId: record.projectId,
    };
  }

  private async selectRecord(
    principal: Principal,
    records: readonly V1OperationReceiptRecord[],
  ): Promise<V1OperationReceiptRecord | null> {
    const ownScopeKey = principalScopeKey(principal);
    const own = records.find((record) => record.principalScopeKey === ownScopeKey);
    if (own) return own;
    if (principal.kind !== 'HUMAN') return null;
    for (const record of records) {
      const credentialId = agentCredentialIdOf(record.principalScopeKey);
      if (!credentialId) continue;
      const ownerUserId = await this.repository.findAgentCredentialOwner(credentialId);
      if (ownerUserId === principal.userId) return record;
    }
    return null;
  }
}

function agentCredentialIdOf(scopeKey: string): string | null {
  const prefix = 'agent:';
  if (!scopeKey.startsWith(prefix)) return null;
  const credentialId = scopeKey.slice(prefix.length);
  return credentialId.length > 0 ? credentialId : null;
}
