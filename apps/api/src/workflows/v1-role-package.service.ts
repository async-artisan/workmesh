import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type ActionBinding, type Confirmation, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { verifyTicketBinding, V1_CONFIRMATION_REPOSITORY, type V1ConfirmationRepository } from '../auth/v1-confirmation';
import { sessionIdOf } from '../auth/v1-cli-authorization.service';
import { assertReplayable, requestDigestOf, V1_IDEMPOTENCY_REPOSITORY, type V1IdempotencyRepository } from '../common/v1-idempotency';
import { validateRolePackageInput, type V1RolePackageResourceInput } from './v1-role-package-policy';
import {
  V1_ROLE_PACKAGE_REPOSITORY,
  type V1RolePackageDetail,
  type V1RolePackageListItem,
  type V1RolePackageRepository,
  type V1RolePackageResourceView,
} from './v1-role-package.repository';

export const ROLE_PACKAGE_PUBLISH = 'ROLE_PACKAGE_PUBLISH';
export const ROLE_PACKAGE_TARGET = 'ROLE_PACKAGE';

export type V1RolePackageContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  operationId: string;
  now: Date;
  webSessionId: string;
  userAuthVersion: number;
};

export type V1RegisterRolePackageRequest = {
  expectedVersion: number;
  manifest: Record<string, unknown>;
  resources: V1RolePackageResourceInput[];
  confirmation: Confirmation;
};

@Injectable()
export class V1RolePackageService {
  constructor(
    @Inject(V1_ROLE_PACKAGE_REPOSITORY) private readonly repository: V1RolePackageRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async list(
    principal: Principal,
    projectId: string,
    query: { limit?: number; cursor?: string | null },
  ): Promise<{ items: V1RolePackageListItem[]; nextCursor: string | null }> {
    await this.requireRead(principal, projectId);
    const limit = Number.isInteger(query.limit) ? Math.min(Math.max(query.limit ?? 20, 1), 100) : 20;
    return this.repository.list(projectId, { limit, cursor: query.cursor ?? null });
  }

  async getVersion(principal: Principal, projectId: string, packageId: string, version: string): Promise<V1RolePackageDetail> {
    await this.requireRead(principal, projectId);
    const found = await this.repository.findVersion(projectId, packageId, version);
    if (!found)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'ROLE_PACKAGE_NOT_FOUND',
        { packageId, version },
        404,
      );
    return found;
  }

  async getResource(
    principal: Principal,
    projectId: string,
    packageId: string,
    version: string,
    resourceId: string,
  ): Promise<V1RolePackageResourceView> {
    const detail = await this.getVersion(principal, projectId, packageId, version);
    const resource = await this.repository.findResource(detail.id, resourceId);
    if (!resource)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'ROLE_PACKAGE_RESOURCE_NOT_FOUND',
        { packageId, version, resourceId },
        404,
      );
    return resource;
  }

  async register(
    principal: Principal,
    projectId: string,
    input: V1RegisterRolePackageRequest,
    context: V1RolePackageContext,
  ) {
    const project = await this.requireManager(principal, projectId);

    // 合法重放先于项目版本 CAS 与票据消费。
    const requestDigest = requestDigestOf({ method: context.method, route: context.route, body: context.body });
    const projectScopeKey = `project:${projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const replay = await this.repository.findOperation({ projectScopeKey, principalScopeKey, key: context.idempotencyKey });
    if (replay) {
      assertReplayable(replay, { method: context.method, route: context.route, digest: requestDigest });
      return {
        packageVersionId: String(replay.resultRefs.packageVersionId ?? ''),
        packageId: String(replay.resultRefs.packageId ?? ''),
        version: String(replay.resultRefs.version ?? ''),
        manifestDigest: String(replay.resultRefs.manifestDigest ?? ''),
        projectVersion: Number(replay.resultRefs.projectVersion ?? project.version),
        replayed: true,
      };
    }

    const validation = await validateRolePackageInput(input.manifest, input.resources);
    if (!validation.valid)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'ROLE_PACKAGE_INVALID',
        { issues: validation.issues },
        422,
      );
    const manifest = validation.manifest!;
    const manifestDigest = validation.manifestDigest!;

    const roleKeys = await this.repository.projectRoleKeys(projectId);
    if (!roleKeys.includes(manifest.roleKey))
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'ROLE_PACKAGE_ROLE_UNKNOWN',
        { issues: [{ path: '/roleKey', code: 'WORKFLOW_ROLE_UNKNOWN', message: `role ${manifest.roleKey} is not an active project role` }] },
        422,
      );

    // 项目私有包不得遮蔽内置包的同名版本。
    if (await this.repository.hasBuiltin(manifest.id))
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'ROLE_PACKAGE_ID_SHADOWED',
        { packageId: manifest.id },
        409,
      );

    const existing = await this.repository.findVersion(projectId, manifest.id, manifest.version);
    if (existing) {
      if (existing.scope === 'PROJECT' && existing.manifestDigest === manifestDigest)
        return {
          packageVersionId: existing.id,
          packageId: existing.packageId,
          version: existing.version,
          manifestDigest: existing.manifestDigest,
          projectVersion: project.version,
          replayed: false,
        };
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'ROLE_PACKAGE_VERSION_CONFLICT',
        { packageId: manifest.id, version: manifest.version },
        409,
      );
    }

    if (project.version !== input.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'PROJECT_VERSION_CONFLICT',
        { expectedVersion: input.expectedVersion, currentVersion: project.version },
        409,
      );

    const binding: ActionBinding = {
      action: ROLE_PACKAGE_PUBLISH,
      projectId,
      targetType: ROLE_PACKAGE_TARGET,
      targetId: manifest.id,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: {
        version: manifest.version,
        manifestDigest,
        resourceIds: validation.resources.map((resource) => resource.resourceId).sort(),
      },
    };
    const ticket = await this.tickets.findTicket(input.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: input.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: input.confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding,
      now: context.now,
    });

    const registered = await this.repository.register({
      projectId,
      packageId: manifest.id,
      version: manifest.version,
      roleKey: manifest.roleKey,
      manifest,
      manifestDigest,
      resources: validation.resources,
      expectedProjectVersion: input.expectedVersion,
      actorUserId: principal.userId,
      userAuthVersion: context.userAuthVersion,
      ticket: { id: ticket.id, secretHash: ticket.secretHash, webSessionId: sessionIdOf(principal) },
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    });
    return { ...registered, replayed: false };
  }

  private async requireRead(principal: Principal, projectId: string) {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    if (principal.kind === 'AGENT' && !principal.scopes.includes('workflow:read'))
      throw new WorkmeshError(V1_ERROR_CODES.SCOPE_DENIED, 'SCOPE_DENIED', { scope: 'workflow:read' }, 403);
    return context;
  }

  private async requireManager(principal: Principal, projectId: string) {
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    if (context.membership.role !== 'OWNER' && context.membership.role !== 'ADMIN')
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'PROJECT_MANAGER_REQUIRED', { projectId }, 403);
    return context.project;
  }
}
