/**
 * 就绪任务查询仓储边界。
 * 责任范围与基础状态由仓储用一次 SQL 过滤；依赖门槛由服务层批量评估，避免每任务一次查询。
 */

export const V1_READY_REPOSITORY = Symbol('V1_READY_REPOSITORY');

export type V1ReadyOwnership =
  | { kind: 'ALL' }
  | { kind: 'HUMAN'; userId: string; roleIds: readonly string[] }
  | { kind: 'AGENT'; roleId: string };

export type V1ReadyCursor = { stepKey: string; id: string };

export type V1ReadyCandidate = {
  id: string;
  projectId: string;
  workflowInstanceId: string;
  stepKey: string;
  roleId: string;
  responsibleUserId: string;
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaimId: string | null;
  definitionRevisionId: string | null;
};

export type V1ReadyRevisionStep = { key: string; deps: readonly string[] };

export type V1ReadyRevisionSteps = {
  revisionId: string;
  projectId: string;
  steps: readonly V1ReadyRevisionStep[];
};

export type V1ReadyInstanceStep = {
  workflowInstanceId: string;
  stepKey: string;
  executionStatus: string;
  workStatus: string;
};

export type V1ReadyCandidatePage = {
  items: V1ReadyCandidate[];
  hasMore: boolean;
};

export interface V1ReadyRepository {
  listCandidates(input: {
    projectId: string;
    roleId: string | null;
    ownership: V1ReadyOwnership;
    after: V1ReadyCursor | null;
    take: number;
  }): Promise<V1ReadyCandidatePage>;
  findRevisionSteps(revisionIds: readonly string[]): Promise<V1ReadyRevisionSteps[]>;
  listInstanceTasks(instanceIds: readonly string[]): Promise<V1ReadyInstanceStep[]>;
}
