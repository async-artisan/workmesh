import type { WorkflowCompiledRules, WorkflowPackageLock } from '@workmesh/shared';
import type { V1OperationRecord } from '../common/v1-idempotency';

export type V1WorkflowRole = {
  id: string;
  key: string;
  title: string;
  isActive: boolean;
  version: number;
};

export type V1WorkflowDefinitionView = {
  workflowKey: string;
  title: string;
  version: number;
  currentPublishedRevisionId: string | null;
  currentRevision: number;
};

export type V1WorkflowRevisionView = {
  id: string;
  projectId: string;
  definitionId: string;
  workflowKey: string;
  revision: number;
  digest: string;
  definition: unknown;
  compiledRules: WorkflowCompiledRules;
  createdAt: Date;
};

export type V1WorkflowStepView = {
  stepKey: string;
  roleId: string;
  responsibleUserId: string;
  executionStatus: string;
  workStatus: string;
  generation: number;
  version: number;
  repositoryIds: string[];
};

export type V1WorkflowInstanceView = {
  id: string;
  projectId: string;
  requirementId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  version: number;
  workStatus: string;
  retiredAt: Date | null;
  steps: V1WorkflowStepView[];
};

export type V1RequirementWorkflowView = {
  id: string;
  projectId: string;
  version: number;
  currentPrdRevisionId: string | null;
  deliveryScope: unknown;
};

export type V1PackageVersionRecord = {
  packageId: string;
  version: string;
  roleKey: string;
  manifestDigest: string;
  projectId: string | null;
};

export type V1PublishDefinitionInput = {
  projectId: string;
  workflowKey: string;
  title: string;
  expectedProjectVersion: number;
  expectedCurrentRevision: number;
  definition: unknown;
  definitionDigest: string;
  compiledRules: WorkflowCompiledRules;
  packageLocks: WorkflowPackageLock[];
  actorUserId: string;
  ticket: { id: string; secretHash: string; webSessionId: string };
  now: Date;
  operation: {
    id: string;
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
    method: string;
    route: string;
    requestDigest: string;
  };
};

export type V1PublishDefinitionResult = {
  definitionRevisionId: string;
  revision: number;
  digest: string;
  projectVersion: number;
};

export type V1CreateInstanceStepBinding = {
  stepKey: string;
  roleId: string;
  responsibleUserId: string;
  repositoryIds: string[];
};

export type V1CreateInstanceSlotBinding = { slotKey: string; roleId: string; userId: string };

export type V1CreateInstanceInput = {
  projectId: string;
  requirementId: string;
  definitionId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  expectedRequirementVersion: number;
  stepBindings: V1CreateInstanceStepBinding[];
  roleSlotBindings: V1CreateInstanceSlotBinding[];
  steps: Array<{
    stepKey: string;
    roleId: string;
    responsibleUserId: string;
    repositoryIds: string[];
    outputKinds: string[];
  }>;
  actorUserId: string;
  operation: {
    id: string;
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
    method: string;
    route: string;
    requestDigest: string;
  };
};

export type V1CreateInstanceResult = {
  instance: V1WorkflowInstanceView;
  requirementVersion: number;
};

export interface V1WorkflowRepository {
  listDefinitions(
    projectId: string,
    query: { limit: number; cursor: string | null },
  ): Promise<{ items: V1WorkflowDefinitionView[]; nextCursor: string | null }>;
  findDefinition(
    projectId: string,
    workflowKey: string,
  ): Promise<(V1WorkflowDefinitionView & { id: string }) | null>;
  findRevision(revisionId: string): Promise<V1WorkflowRevisionView | null>;
  projectRoles(projectId: string): Promise<V1WorkflowRole[]>;
  findPackageVersion(
    projectId: string,
    packageId: string,
    version: string,
  ): Promise<V1PackageVersionRecord | null>;
  findRequirement(requirementId: string): Promise<V1RequirementWorkflowView | null>;
  isActiveMember(projectId: string, userId: string): Promise<boolean>;
  isProjectRepository(projectId: string, repositoryId: string): Promise<boolean>;
  publishDefinition(input: V1PublishDefinitionInput): Promise<V1PublishDefinitionResult>;
  findPublishOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null>;
  createInstance(input: V1CreateInstanceInput): Promise<V1CreateInstanceResult>;
  findInstance(instanceId: string): Promise<V1WorkflowInstanceView | null>;
}

export const V1_WORKFLOW_REPOSITORY = Symbol('V1_WORKFLOW_REPOSITORY');
