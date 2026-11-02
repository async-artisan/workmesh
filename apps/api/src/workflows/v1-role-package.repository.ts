import type { RolePackageManifest } from '@workmesh/shared';
import type { V1OperationRecord } from '../common/v1-idempotency';
import type { V1NormalizedPackageResource } from './v1-role-package-policy';

export type V1RolePackageScope = 'BUILTIN' | 'PROJECT';

export type V1RolePackageListItem = {
  id: string;
  packageId: string;
  version: string;
  roleKey: string;
  manifestDigest: string;
  scope: V1RolePackageScope;
};

export type V1RolePackageDetail = V1RolePackageListItem & {
  projectId: string | null;
  manifest: RolePackageManifest;
};

export type V1RolePackageResourceView = {
  resourceId: string;
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  bodyBytes: Uint8Array;
};

export type V1RegisterRolePackageInput = {
  projectId: string;
  packageId: string;
  version: string;
  roleKey: string;
  manifest: RolePackageManifest;
  manifestDigest: string;
  resources: V1NormalizedPackageResource[];
  expectedProjectVersion: number;
  actorUserId: string;
  userAuthVersion: number;
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

export type V1RegisterRolePackageResult = {
  packageVersionId: string;
  packageId: string;
  version: string;
  manifestDigest: string;
  projectVersion: number;
};

export interface V1RolePackageRepository {
  list(
    projectId: string,
    query: { limit: number; cursor: string | null },
  ): Promise<{ items: V1RolePackageListItem[]; nextCursor: string | null }>;
  /** 只返回内置包或本项目的私有包，不跨项目暴露同名私有包。 */
  findVersion(projectId: string, packageId: string, version: string): Promise<V1RolePackageDetail | null>;
  findResource(packageVersionId: string, resourceId: string): Promise<V1RolePackageResourceView | null>;
  hasBuiltin(packageId: string): Promise<boolean>;
  projectRoleKeys(projectId: string): Promise<string[]>;
  findProject(projectId: string): Promise<{ id: string; version: number } | null>;
  findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null>;
  register(input: V1RegisterRolePackageInput): Promise<V1RegisterRolePackageResult>;
}

export const V1_ROLE_PACKAGE_REPOSITORY = Symbol('V1_ROLE_PACKAGE_REPOSITORY');
