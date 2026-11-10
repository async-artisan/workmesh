/**
 * v1 任务认领／释放／工作态仓储边界（T04）。
 *
 * 所有写操作在隔离 PostgreSQL 的单一事务内完成：项目行 FOR UPDATE 串行边界、
 * 代次／活跃认领复核、幂等操作同事务落盘。并发正确性只能在隔离库验证，mock 不代替。
 */

export const V1_TASK_REPOSITORY = Symbol('V1_TASK_REPOSITORY');

export type V1ClaimSnapshot = {
  id: string;
  taskGeneration: number;
  principalScopeKey: string;
  releasedAt: string | null;
  userId: string;
};

export type V1TaskSnapshot = {
  id: string;
  projectId: string;
  workflowInstanceId: string;
  stepKey: string;
  stepDisplayName?: string | null;
  roleId: string;
  responsibleUserId: string;
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaim: V1ClaimSnapshot | null;
};

export type V1WorkflowStepContract = {
  workflowDefinitionRevisionId: string;
  stepKey: string;
  kind: string | null;
  outputKinds: string[];
};

export type V1TaskOperationInput = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
};

export type V1ClaimInput = {
  /** 仓储必须在项目锁内重读责任人、活动角色、凭据和当前流程依赖后才创建认领。 */
  taskId: string;
  expectedGeneration: number;
  principalScopeKey: string;
  userId: string;
  credentialId: string | null;
  now: Date;
  operation: V1TaskOperationInput;
};

export type V1ReleaseInput = {
  taskId: string;
  expectedGeneration: number;
  claimId: string;
  principalScopeKey: string;
  now: Date;
  releaseReason?: string | null;
  operation: V1TaskOperationInput;
};

export type V1SetWorkStatusInput = {
  taskId: string;
  expectedGeneration: number;
  claimId: string;
  principalScopeKey: string;
  workStatus: string;
  now: Date;
  operation: V1TaskOperationInput;
};

export interface V1TaskRepository {
  findTask(taskId: string): Promise<V1TaskSnapshot | null>;
  /** Immutable workflow contract used to validate delivery before the write transaction. */
  findWorkflowStepContract?(taskId: string): Promise<V1WorkflowStepContract | null>;
  claim(input: V1ClaimInput): Promise<V1TaskSnapshot>;
  release(input: V1ReleaseInput): Promise<V1TaskSnapshot>;
  setWorkStatus(input: V1SetWorkStatusInput): Promise<V1TaskSnapshot>;
}
