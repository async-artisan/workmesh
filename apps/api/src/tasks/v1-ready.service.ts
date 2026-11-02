import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1ProjectContext } from '../auth/v1-authorization';
import {
  V1_READY_REPOSITORY,
  type V1ReadyCandidate,
  type V1ReadyCursor,
  type V1ReadyOwnership,
  type V1ReadyRepository,
} from './v1-ready.repository';

export type V1ReadyTaskView = {
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
  currentClaim: null;
};

export type V1ReadyPage = {
  items: V1ReadyTaskView[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type V1ReadyQuery = { roleId?: string | null; limit?: number; cursor?: string | null };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CURSOR_FIELD_MAX = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

function invalidCursor(cursor: string): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'INVALID_CURSOR', { cursor }, 400);
}

function validCursorField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= CURSOR_FIELD_MAX;
}

function encodeCursor(cursor: V1ReadyCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, stepKey: cursor.stepKey, id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(raw: string | null | undefined): V1ReadyCursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw invalidCursor(String(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor(raw);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidCursor(raw);
  const value = parsed as { v?: unknown; stepKey?: unknown; id?: unknown };
  if (value.v !== 1 || !validCursorField(value.stepKey) || !validCursorField(value.id))
    throw invalidCursor(raw);
  return { stepKey: value.stepKey, id: value.id };
}

/**
 * 就绪任务列表（只读）。
 *
 * 先按项目/角色/责任范围做 SQL 过滤，再按工作流修订的步骤依赖批量判定：
 * 实例无基线修订、修订或步骤缺失、任一前序任务未 DONE 时一律不就绪；读取失败按不就绪处理，不抛 500。
 */
@Injectable()
export class V1ReadyService {
  constructor(
    @Inject(V1_READY_REPOSITORY) private readonly repository: V1ReadyRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  async ready(principal: Principal, projectId: string, query: V1ReadyQuery): Promise<V1ReadyPage> {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'task:read');

    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const roleId = this.roleFilter(principal, query.roleId ?? null, projectId);
    const ownership = this.ownershipOf(principal, context);

    const items: V1ReadyTaskView[] = [];
    let scanCursor = cursor;
    let nextCursor: string | null = null;
    let hasMore = false;

    while (true) {
      let page;
      try {
        page = await this.repository.listCandidates({
          projectId,
          roleId,
          ownership,
          after: scanCursor,
          take: limit,
        });
      } catch {
        break;
      }
      if (page.items.length === 0) break;

      let readyIds: Set<string>;
      try {
        readyIds = await this.evaluateReady(page.items);
      } catch {
        readyIds = new Set<string>();
      }

      let overflow = false;
      for (const candidate of page.items) {
        scanCursor = { stepKey: candidate.stepKey, id: candidate.id };
        if (!readyIds.has(candidate.id)) continue;
        if (items.length === limit) {
          hasMore = true;
          overflow = true;
          break;
        }
        items.push(this.toView(candidate));
        nextCursor = encodeCursor(scanCursor);
      }
      if (overflow) break;
      if (!page.hasMore) break;
    }

    if (!hasMore) nextCursor = null;
    return { items, nextCursor, hasMore };
  }

  private roleFilter(
    principal: Principal,
    requestedRoleId: string | null,
    projectId: string,
  ): string | null {
    if (principal.kind !== 'AGENT') return requestedRoleId;
    const credentialRoleId = principal.roleIds?.[0];
    if (!credentialRoleId)
      throw new WorkmeshError(
        V1_ERROR_CODES.ROLE_INACTIVE,
        'AGENT_ROLE_ASSIGNMENT_INACTIVE',
        { projectId },
        422,
      );
    if (requestedRoleId !== null && requestedRoleId !== credentialRoleId)
      throw new WorkmeshError(
        V1_ERROR_CODES.SCOPE_DENIED,
        'SCOPE_DENIED',
        { scope: 'task:read', projectId },
        403,
      );
    return credentialRoleId;
  }

  private ownershipOf(principal: Principal, context: V1ProjectContext): V1ReadyOwnership {
    if (principal.kind === 'AGENT') {
      const roleId = principal.roleIds?.[0];
      if (!roleId) return { kind: 'AGENT', roleId: '' };
      return { kind: 'AGENT', roleId };
    }
    if (context.membership.role === 'OWNER' || context.membership.role === 'ADMIN')
      return { kind: 'ALL' };
    return { kind: 'HUMAN', userId: principal.userId, roleIds: context.activeRoleIds };
  }

  private async evaluateReady(candidates: readonly V1ReadyCandidate[]): Promise<Set<string>> {
    const instanceIds = [...new Set(candidates.map((candidate) => candidate.workflowInstanceId))];
    const revisionIds = [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.definitionRevisionId ? [candidate.definitionRevisionId] : [],
        ),
      ),
    ];
    const [instanceTasks, revisions] = await Promise.all([
      this.repository.listInstanceTasks(instanceIds),
      this.repository.findRevisionSteps(revisionIds),
    ]);

    const stepsByRevision = new Map(revisions.map((revision) => [revision.revisionId, revision]));
    const statusByInstanceStep = new Map(
      instanceTasks.map((task) => [
        `${task.workflowInstanceId}:${task.stepKey}`,
        task.executionStatus,
      ]),
    );

    const ready = new Set<string>();
    for (const candidate of candidates) {
      if (
        candidate.executionStatus !== 'OPEN' ||
        candidate.workStatus !== 'ACTIVE' ||
        candidate.currentClaimId !== null
      )
        continue;
      if (!candidate.definitionRevisionId) continue;
      const revision = stepsByRevision.get(candidate.definitionRevisionId);
      if (!revision || revision.projectId !== candidate.projectId) continue;
      const step = revision.steps.find((item) => item.key === candidate.stepKey);
      if (!step) continue;
      const predecessorsDone = step.deps.every(
        (dep) => statusByInstanceStep.get(`${candidate.workflowInstanceId}:${dep}`) === 'DONE',
      );
      if (predecessorsDone) ready.add(candidate.id);
    }
    return ready;
  }

  private toView(candidate: V1ReadyCandidate): V1ReadyTaskView {
    return {
      id: candidate.id,
      projectId: candidate.projectId,
      workflowInstanceId: candidate.workflowInstanceId,
      stepKey: candidate.stepKey,
      roleId: candidate.roleId,
      responsibleUserId: candidate.responsibleUserId,
      version: candidate.version,
      generation: candidate.generation,
      executionStatus: candidate.executionStatus,
      workStatus: candidate.workStatus,
      currentClaim: null,
    };
  }
}
