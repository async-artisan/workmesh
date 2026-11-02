import type { ProjectManagementRole } from '../auth/v1-authorization';

export const PROJECT_ROLE_REPOSITORY = Symbol('PROJECT_ROLE_REPOSITORY');

export type ProjectMemberRecord = {
  projectId: string;
  userId: string;
  role: ProjectManagementRole;
  version: number;
  revokedAt: Date | null;
};

export type ProjectMemberProfile = ProjectMemberRecord & {
  email: string;
};

export type ProjectRoleRecord = {
  id: string;
  projectId: string;
  isActive: boolean;
};

export type ProjectRoleAssignmentRecord = {
  id: string;
  projectId: string;
  userId: string;
  roleId: string;
  version: number;
  revokedAt: Date | null;
};

export type ProjectRoleAssignmentView = {
  id: string;
  userId: string;
  roleId: string;
  version: number;
  revokedAt: string | null;
};

export type ProjectRoleMutationView = {
  member: {
    id: string;
    email: string;
    name: string;
    role: ProjectManagementRole;
    version: number;
  };
  assignment: ProjectRoleAssignmentView;
};

export type ProjectRoleOperation = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
};

export type ProjectRoleChangeInput = {
  projectId: string;
  userId: string;
  roleId: string;
  reason: string;
  expectedVersion: number;
  actorUserId: string;
  webSessionId: string;
  userAuthVersion: number;
  /** 票据定位与条件消费所需字段；摘要与绑定已在事务外核验。 */
  ticket: { id: string; secretHash: string };
  operation: ProjectRoleOperation;
  now: Date;
};

export interface ProjectRoleRepository {
  findManager(projectId: string, userId: string): Promise<ProjectMemberRecord | null>;
  findTargetMember(projectId: string, userId: string): Promise<ProjectMemberProfile | null>;
  findRole(projectId: string, roleId: string): Promise<ProjectRoleRecord | null>;
  findAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<ProjectRoleAssignmentRecord | null>;
  assign(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView>;
  revoke(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView>;
}
