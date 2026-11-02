/**
 * 操作收据读取边界（只读）。
 * 收据来自 IdempotentOperation，不返回响应正文、秘密或可重放语义。
 */

export const V1_OPERATION_RECEIPT_REPOSITORY = Symbol('V1_OPERATION_RECEIPT_REPOSITORY');

export type V1OperationReceiptRecord = {
  id: string;
  projectId: string | null;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
  resultRefs: Record<string, unknown>;
  committedAt: Date | null;
};

export interface V1OperationReceiptRepository {
  /** 同 scope 同 key 的所有主体记录：主体精确匹配优先，其次才判断 Agent 授权用户。 */
  findOperations(input: {
    projectScopeKey: string;
    key: string;
  }): Promise<V1OperationReceiptRecord[]>;
  findAgentCredentialOwner(credentialId: string): Promise<string | null>;
}
