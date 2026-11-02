import { Inject, Injectable } from '@nestjs/common';
import {
  compileWorkflowDefinition,
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Confirmation,
  type Principal,
  type WorkflowCompileResult,
  type WorkflowPackageLock,
} from '@workmesh/shared';
import {
  buildSoftwareDeliveryWorkflowTemplate,
  buildStandardWorkflowTemplate,
  SOFTWARE_DELIVERY_WORKFLOW_KEY,
  STANDARD_WORKFLOW_KEY,
} from '@workmesh/shared';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import { sessionIdOf } from '../auth/v1-cli-authorization.service';
import { V1AuthorizationService } from '../auth/v1-authorization';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  V1_WORKFLOW_REPOSITORY,
  type V1CreateInstanceResult,
  type V1CreateInstanceSlotBinding,
  type V1CreateInstanceStepBinding,
  type V1RequirementWorkflowView,
  type V1WorkflowDefinitionView,
  type V1WorkflowInstanceView,
  type V1WorkflowRepository,
  type V1WorkflowRevisionView,
} from './v1-workflow.repository';

export const WORKFLOW_CONFIG_PUBLISH = 'WORKFLOW_CONFIG_PUBLISH';
export const WORKFLOW_DEFINITION_TARGET = 'WORKFLOW_DEFINITION';

export type V1WorkflowContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  operationId: string;
  now: Date;
  webSessionId: string;
  userAuthVersion: number;
};

export type V1PublishInput = {
  expectedVersion: number;
  expectedCurrentRevision: number;
  definition: Record<string, unknown>;
  packageLocks: WorkflowPackageLock[];
  confirmation: Confirmation;
};

export type V1CreateInstanceRequest = {
  definitionRevisionId: string;
  expectedRequirementVersion: number;
  stepBindings: V1CreateInstanceStepBinding[];
  roleSlotBindings: V1CreateInstanceSlotBinding[];
};

export type V1ValidateInput = {
  definition: Record<string, unknown>;
  packageLocks: WorkflowPackageLock[];
};

function workflowInvalid(
  message: string,
  details?: Record<string, unknown>,
  status = 422,
): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.WORKFLOW_INVALID, message, details, status);
}

@Injectable()
export class V1WorkflowService {
  constructor(
    @Inject(V1_WORKFLOW_REPOSITORY) private readonly repository: V1WorkflowRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async listDefinitions(
    principal: Principal,
    projectId: string,
    query: { limit?: number; cursor?: string | null },
  ): Promise<{ items: V1WorkflowDefinitionView[]; nextCursor: string | null }> {
    await this.requireRead(principal, projectId);
    const limit = Number.isInteger(query.limit)
      ? Math.min(Math.max(query.limit ?? 20, 1), 100)
      : 20;
    return this.repository.listDefinitions(projectId, { limit, cursor: query.cursor ?? null });
  }

  async getRevision(principal: Principal, revisionId: string): Promise<V1WorkflowRevisionView> {
    const revision = await this.repository.findRevision(revisionId);
    if (!revision)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'WORKFLOW_REVISION_NOT_FOUND',
        { revisionId },
        404,
      );
    await this.requireRead(principal, revision.projectId);
    return revision;
  }

  /** 只校验不落库：Agent 只能提交候选校验，不能借此保存批准权威。 */
  async validate(
    principal: Principal,
    projectId: string,
    input: V1ValidateInput,
  ): Promise<WorkflowCompileResult> {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    if (principal.kind === 'AGENT' && !principal.scopes.includes('workflow:propose'))
      throw new WorkmeshError(
        V1_ERROR_CODES.SCOPE_DENIED,
        'SCOPE_DENIED',
        { scope: 'workflow:propose' },
        403,
      );
    if (
      principal.kind === 'HUMAN' &&
      !this.isManager(context.membership.role) &&
      !principal.scopes.includes('workflow:propose')
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'WORKFLOW_PROPOSE_REQUIRED',
        undefined,
        403,
      );
    return this.compile(projectId, input.definition, input.packageLocks);
  }

  /** 内置流程模板：供 Web 编辑器载入，仍需走 validate → publish 的正式流程。 */
  async templates(principal: Principal, projectId: string) {
    await this.requireManager(principal, projectId);
    return [
      {
        key: STANDARD_WORKFLOW_KEY,
        title: '标准交付流程',
        definition: buildStandardWorkflowTemplate(),
      },
      {
        key: SOFTWARE_DELIVERY_WORKFLOW_KEY,
        title: '软件交付流程',
        definition: buildSoftwareDeliveryWorkflowTemplate(),
      },
      {
        key: 'software-delivery-no-ui',
        title: '软件交付（复用设计）',
        definition: buildSoftwareDeliveryWorkflowTemplate({
          workflowKey: 'software-delivery-no-ui',
          title: '软件交付（复用设计）',
          excludeUi: true,
        }),
      },
    ];
  }

  async publish(
    principal: Principal,
    projectId: string,
    workflowKey: string,
    input: V1PublishInput,
    context: V1WorkflowContext,
  ) {
    const project = await this.requireManager(principal, projectId);
    if (
      typeof input.definition.workflowKey !== 'string' ||
      input.definition.workflowKey !== workflowKey
    )
      throw workflowInvalid('路径 workflowKey 必须等于 definition.workflowKey', { workflowKey });

    // 合法重放在票据消费与版本 CAS 之前返回原结果：旧票据已消费、项目版本已递增都不影响重放。
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const projectScopeKey = `project:${projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const replay = await this.repository.findPublishOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (replay) {
      assertReplayable(replay, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      return {
        definitionRevisionId: String(replay.resultRefs.definitionRevisionId ?? ''),
        revision: Number(replay.resultRefs.revision ?? 0),
        digest: String(replay.resultRefs.digest ?? ''),
        projectVersion: Number(replay.resultRefs.projectVersion ?? project.version),
        replayed: true,
      };
    }

    if (project.version !== input.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'PROJECT_VERSION_CONFLICT',
        { expectedVersion: input.expectedVersion, currentVersion: project.version },
        409,
      );

    const existing = await this.repository.findDefinition(projectId, workflowKey);
    const currentRevision = existing?.currentRevision ?? 0;
    if (input.expectedCurrentRevision !== currentRevision)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'WORKFLOW_REVISION_CONFLICT',
        { expectedCurrentRevision: input.expectedCurrentRevision, currentRevision },
        409,
      );

    await this.verifyBase(input.definition, projectId, existing, input.expectedCurrentRevision);
    const compiled = await this.compile(projectId, input.definition, input.packageLocks);
    if (!compiled.valid)
      throw workflowInvalid('工作流未通过服务端编译', { issues: compiled.issues });
    const compiledDigest = compiled.digest!;

    await this.verifyRemovals(input.definition, existing);

    const binding: ActionBinding = {
      action: WORKFLOW_CONFIG_PUBLISH,
      projectId,
      targetType: WORKFLOW_DEFINITION_TARGET,
      targetId: workflowKey,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: {
        expectedCurrentRevision: input.expectedCurrentRevision,
        compiledDigest,
        packageLocks: [...input.packageLocks]
          .map((lock) => ({
            roleKey: lock.roleKey,
            packageId: lock.packageId,
            version: lock.version,
            packageDigest: lock.packageDigest,
          }))
          .sort((left, right) => left.roleKey.localeCompare(right.roleKey)),
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

    const published = await this.repository.publishDefinition({
      projectId,
      workflowKey,
      title: String(input.definition.title ?? workflowKey),
      expectedProjectVersion: input.expectedVersion,
      expectedCurrentRevision: input.expectedCurrentRevision,
      definition: input.definition,
      definitionDigest: compiledDigest,
      compiledRules: compiled.compiledRules!,
      packageLocks: input.packageLocks,
      actorUserId: principal.userId,
      ticket: {
        id: ticket.id,
        secretHash: ticket.secretHash,
        webSessionId: sessionIdOf(principal),
      },
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
    return { ...published, replayed: false };
  }

  async createInstance(
    principal: Principal,
    requirementId: string,
    input: V1CreateInstanceRequest,
    context: V1WorkflowContext,
  ): Promise<{ instance: V1WorkflowInstanceView; requirementVersion: number; replayed: boolean }> {
    const requirement = await this.repository.findRequirement(requirementId);
    if (!requirement)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId },
        404,
      );
    await this.requireManager(principal, requirement.projectId);

    // 合法重放先于 requirement 版本 CAS：首次创建已递增版本，重放仍返回原实例。
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const projectScopeKey = `project:${requirement.projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const replay = await this.repository.findPublishOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (replay) {
      assertReplayable(replay, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const snapshot = await this.repository.findInstance(
        String(replay.resultRefs.instanceId ?? ''),
      );
      if (!snapshot)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'INSTANCE_NOT_FOUND',
          undefined,
          404,
        );
      return {
        instance: snapshot,
        requirementVersion: Number(replay.resultRefs.requirementVersion ?? 0),
        replayed: true,
      };
    }

    const revision = await this.repository.findRevision(input.definitionRevisionId);
    if (!revision || revision.projectId !== requirement.projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'WORKFLOW_REVISION_NOT_FOUND',
        { definitionRevisionId: input.definitionRevisionId },
        404,
      );
    // 只允许以当前已发布的不可变修订创建实例，不能用旧修订绕过裁剪或包锁。
    const definition = await this.repository.findDefinition(
      requirement.projectId,
      revision.workflowKey,
    );
    if (!definition || definition.currentPublishedRevisionId !== revision.id)
      throw new WorkmeshError(
        V1_ERROR_CODES.WORKFLOW_INVALID,
        'WORKFLOW_REVISION_NOT_CURRENT',
        { revisionId: revision.id },
        409,
      );

    if (input.expectedRequirementVersion !== requirement.version)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'REQUIREMENT_VERSION_CONFLICT',
        {
          expectedRequirementVersion: input.expectedRequirementVersion,
          currentVersion: requirement.version,
        },
        409,
      );

    const steps = this.bindSteps(revision, input.stepBindings);
    this.verifyAcceptanceCoverage(requirement, steps);
    await this.verifyBindings(requirement.projectId, revision, input.roleSlotBindings, steps);
    this.verifyDeliveryScope(requirement, revision, steps);

    const created: V1CreateInstanceResult = await this.repository.createInstance({
      projectId: requirement.projectId,
      requirementId,
      definitionId: definition.id,
      definitionRevisionId: revision.id,
      definitionDigest: revision.digest,
      expectedRequirementVersion: requirement.version,
      stepBindings: steps.map((step) => ({
        stepKey: step.stepKey,
        roleId: step.roleId,
        responsibleUserId: step.responsibleUserId,
        repositoryIds: step.repositoryIds,
        acceptanceKeys: step.acceptanceKeys,
      })),
      roleSlotBindings: input.roleSlotBindings,
      steps,
      actorUserId: principal.userId,
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
    return { ...created, replayed: false };
  }

  async getInstance(principal: Principal, instanceId: string): Promise<V1WorkflowInstanceView> {
    const instance = await this.repository.findInstance(instanceId);
    if (!instance)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'INSTANCE_NOT_FOUND',
        { instanceId },
        404,
      );
    await this.requireRead(principal, instance.projectId);
    return instance;
  }

  private async compile(
    projectId: string,
    definition: Record<string, unknown>,
    packageLocks: WorkflowPackageLock[],
  ) {
    const roles = await this.repository.projectRoles(projectId);
    const roleIdsByKey: Record<string, string> = {};
    for (const role of roles) if (role.isActive) roleIdsByKey[role.key] = role.id;
    const compiled = await compileWorkflowDefinition(definition, { roleIdsByKey, packageLocks });
    if (compiled.compiledRules) {
      for (const lock of packageLocks) {
        const registered = await this.repository.findPackageVersion(
          projectId,
          lock.packageId,
          lock.version,
        );
        if (
          !registered ||
          registered.roleKey !== lock.roleKey ||
          registered.manifestDigest !== lock.packageDigest
        )
          compiled.issues.push({
            path: `/packageLocks/${lock.roleKey}`,
            code: 'WORKFLOW_PACKAGE_INCOMPATIBLE',
            message: 'package lock does not match a registered package version',
          });
      }
      if (compiled.issues.length > 0)
        return { valid: false, issues: compiled.issues, digest: null, compiledRules: null };
    }
    return compiled;
  }

  private async verifyBase(
    definition: Record<string, unknown>,
    projectId: string,
    existing: (V1WorkflowDefinitionView & { id: string }) | null,
    expectedCurrentRevision: number,
  ): Promise<void> {
    const baseRevisionId = definition.baseRevisionId;
    if (expectedCurrentRevision === 0) {
      if (baseRevisionId === null) return;
      if (typeof baseRevisionId !== 'string')
        throw workflowInvalid('baseRevisionId 必须为 UUID 或 null');
      const base = await this.repository.findRevision(baseRevisionId);
      if (!base || base.projectId !== projectId)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'BASE_REVISION_NOT_FOUND',
          { baseRevisionId },
          404,
        );
      return;
    }
    if (!existing?.currentPublishedRevisionId)
      throw workflowInvalid('当前工作流没有已发布修订，expectedCurrentRevision 必须为 0');
    if (baseRevisionId !== existing.currentPublishedRevisionId)
      throw workflowInvalid('后续发布的 baseRevisionId 必须等于当前已发布修订', {
        baseRevisionId,
        currentPublishedRevisionId: existing.currentPublishedRevisionId,
      });
  }

  private async verifyRemovals(
    definition: Record<string, unknown>,
    existing: (V1WorkflowDefinitionView & { id: string }) | null,
  ): Promise<void> {
    const removals = definition.stepRemovals;
    if (!Array.isArray(removals)) throw workflowInvalid('stepRemovals 必须是数组');
    const current = existing?.currentPublishedRevisionId
      ? await this.repository.findRevision(existing.currentPublishedRevisionId)
      : null;
    const currentSteps = current ? this.definitionSteps(current.definition) : [];
    const nextSteps = new Set(this.definitionSteps(definition).map((step) => step.key));
    for (const [index, removal] of removals.entries()) {
      if (!removal || typeof removal !== 'object')
        throw workflowInvalid(`stepRemovals[${index}] 必须是对象`);
      const key = (removal as Record<string, unknown>).stepKey;
      if (typeof key !== 'string' || !currentSteps.some((step) => step.key === key))
        throw workflowInvalid(`stepRemovals 不能列出不存在的步骤`, { index, stepKey: key });
      const reason = (removal as Record<string, unknown>).reason;
      if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 500)
        throw workflowInvalid(`步骤 ${key} 的删除理由长度必须为 1–500`);
    }
    for (const step of currentSteps) {
      if (
        !nextSteps.has(step.key) &&
        !removals.some((item) => (item as Record<string, unknown>).stepKey === step.key)
      )
        throw workflowInvalid(
          '删除的每个步骤必须恰有一条 stepRemovals 理由',
          { stepKey: step.key },
          409,
        );
    }
    // 裁剪后仍需经过全量 DAG/gate/scope 编译；这里只补删除理由与基线一致性。
  }

  private definitionSteps(
    definition: unknown,
  ): Array<{ key: string; roleKey: string; deps: string[]; outputKinds: string[] }> {
    const steps = (definition as { steps?: Array<Record<string, unknown>> })?.steps ?? [];
    return steps.map((step) => ({
      key: String(step.key),
      roleKey: String(step.roleKey),
      deps: Array.isArray(step.deps) ? step.deps.map(String) : [],
      outputKinds: Array.isArray(step.outputKinds) ? step.outputKinds.map(String) : [],
    }));
  }

  private bindSteps(
    revision: V1WorkflowRevisionView,
    bindings: V1CreateInstanceStepBinding[],
  ): Array<{
    stepKey: string;
    roleId: string;
    responsibleUserId: string;
    repositoryIds: string[];
    acceptanceKeys: string[];
    outputKinds: string[];
  }> {
    const expected = this.definitionSteps(revision.definition);
    if (new Set(bindings.map((binding) => binding.stepKey)).size !== bindings.length)
      throw workflowInvalid('stepBindings 含重复步骤');
    for (const binding of bindings) {
      if (!expected.some((step) => step.key === binding.stepKey))
        throw workflowInvalid('stepBindings 含未定义步骤', { stepKey: binding.stepKey });
    }
    if (bindings.length !== expected.length)
      throw workflowInvalid('stepBindings 必须精确覆盖全部步骤', {
        expected: expected.map((step) => step.key),
        provided: bindings.map((binding) => binding.stepKey),
      });

    return expected.map((step) => {
      const binding = bindings.find((item) => item.stepKey === step.key)!;
      const resolved = revision.compiledRules.resolvedRoles.find(
        (item) => item.stepKey === step.key,
      );
      if (!resolved) throw workflowInvalid('编译规则缺少步骤角色', { stepKey: step.key });
      if (binding.roleId !== resolved.roleId)
        throw workflowInvalid('stepBinding 的 roleId 与编译后的角色不一致', {
          stepKey: step.key,
          expectedRoleId: resolved.roleId,
          roleId: binding.roleId,
        });
      const repositoryIds = Array.isArray(binding.repositoryIds) ? binding.repositoryIds : [];
      if (step.outputKinds.includes('IMPL') && repositoryIds.length === 0)
        throw workflowInvalid('IMPL 步骤必须声明非空代码仓库范围', { stepKey: step.key });
      return {
        stepKey: step.key,
        roleId: binding.roleId,
        responsibleUserId: binding.responsibleUserId,
        repositoryIds,
        acceptanceKeys: Array.isArray(binding.acceptanceKeys) ? binding.acceptanceKeys : [],
        outputKinds: step.outputKinds,
      };
    });
  }

  /**
   * 每条 PRD 验收必须至少被一个任务覆盖；未知 key 说明写错，直接拒绝。
   * 需求没有 PRD（acceptanceKeys 为空）时跳过，允许先建实例再补 PRD。
   */
  private verifyAcceptanceCoverage(
    requirement: V1RequirementWorkflowView,
    steps: Array<{ acceptanceKeys: string[] }>,
  ): void {
    const prdKeys = requirement.acceptanceKeys ?? [];
    if (prdKeys.length === 0) return;
    const covered = new Set(steps.flatMap((step) => step.acceptanceKeys));
    const missing = prdKeys.filter((key) => !covered.has(key));
    const unknown = [...covered].filter((key) => !prdKeys.includes(key));
    if (missing.length > 0 || unknown.length > 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'UNCOVERED_ACCEPTANCE',
        { missing, unknown },
        422,
      );
  }

  private async verifyBindings(
    projectId: string,
    revision: V1WorkflowRevisionView,
    slotBindings: V1CreateInstanceSlotBinding[],
    steps: Array<{ stepKey: string; responsibleUserId: string; repositoryIds: string[] }>,
  ): Promise<void> {
    const slots = (
      (revision.definition as { roleSlots?: Array<Record<string, unknown>> }).roleSlots ?? []
    ).map((slot) => ({
      key: String(slot.key),
      roleKey: String(slot.roleKey),
    }));
    if (new Set(slotBindings.map((binding) => binding.slotKey)).size !== slotBindings.length)
      throw workflowInvalid('roleSlotBindings 含重复槽位');
    for (const binding of slotBindings) {
      if (!slots.some((slot) => slot.key === binding.slotKey))
        throw workflowInvalid('roleSlotBindings 含未定义槽位', { slotKey: binding.slotKey });
      const resolved = revision.compiledRules.resolvedRoles.find(
        (item) => item.roleKey === binding.roleId,
      );
      const slotRoleKey = slots.find((slot) => slot.key === binding.slotKey)?.roleKey;
      const roleMatches = revision.compiledRules.resolvedRoles.some(
        (item) => item.roleId === binding.roleId && item.roleKey === slotRoleKey,
      );
      if (!roleMatches)
        throw workflowInvalid('roleSlotBinding 的角色与槽位声明不一致', {
          slotKey: binding.slotKey,
          roleId: binding.roleId,
          expectedRoleKey: slotRoleKey,
          resolved: resolved?.roleKey ?? null,
        });
      if (!(await this.repository.isActiveMember(projectId, binding.userId)))
        throw workflowInvalid('roleSlotBinding 指定的审批人不是当前项目成员', {
          userId: binding.userId,
        });
    }
    if (slotBindings.length !== slots.length)
      throw workflowInvalid('roleSlotBindings 必须精确覆盖全部审批槽', {
        expected: slots.map((slot) => slot.key),
        provided: slotBindings.map((binding) => binding.slotKey),
      });

    for (const step of steps) {
      if (!(await this.repository.isActiveMember(projectId, step.responsibleUserId)))
        throw workflowInvalid('步骤责任人不是当前项目成员', {
          stepKey: step.stepKey,
          userId: step.responsibleUserId,
        });
      for (const repositoryId of step.repositoryIds) {
        if (!(await this.repository.isProjectRepository(projectId, repositoryId)))
          throw workflowInvalid('步骤引用了不属于本项目的代码仓库', {
            stepKey: step.stepKey,
            repositoryId,
          });
      }
    }
  }

  /** PRD 的 deliveryScope 一旦人工确认，实例必须覆盖其参与角色与必需产物，且不得删 IMPL。 */
  private verifyDeliveryScope(
    requirement: { deliveryScope: unknown },
    revision: V1WorkflowRevisionView,
    steps: Array<{ roleId: string; outputKinds: string[] }>,
  ): void {
    const scope = requirement.deliveryScope as
      { participatingRoleIds?: string[]; requiredOutputKinds?: string[] } | null | undefined;
    if (!scope || !Array.isArray(scope.participatingRoleIds)) return;
    const instanceRoleIds = new Set(steps.map((step) => step.roleId));
    const instanceKinds = new Set(steps.flatMap((step) => step.outputKinds));
    for (const roleId of scope.participatingRoleIds) {
      if (!instanceRoleIds.has(roleId))
        throw workflowInvalid('流程实例未覆盖已确认交付范围中的参与角色', { roleId }, 409);
    }
    for (const kind of scope.requiredOutputKinds ?? []) {
      if (!instanceKinds.has(kind))
        throw workflowInvalid(
          '流程实例未覆盖已确认交付范围中的必需产物',
          { outputKind: kind },
          409,
        );
    }
  }

  private async requireRead(principal: Principal, projectId: string) {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    if (principal.kind === 'AGENT' && !principal.scopes.includes('workflow:read'))
      throw new WorkmeshError(
        V1_ERROR_CODES.SCOPE_DENIED,
        'SCOPE_DENIED',
        { scope: 'workflow:read' },
        403,
      );
    return context;
  }

  private async requireManager(principal: Principal, projectId: string) {
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    if (!this.isManager(context.membership.role))
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );
    return context.project;
  }

  private isManager(role: string): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }
}
