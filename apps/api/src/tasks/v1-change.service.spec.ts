import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
  type Scope,
} from '@workmesh/shared';
import type { V1AuthorizationRepository } from '../auth/v1-authorization';
import {
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { V1ChangeService } from './v1-change.service';
import {
  type V1AckInput,
  type V1ChangeEventWithRecipients,
  type V1ChangeListQuery,
  type V1ChangeListResult,
  type V1ChangeRecipientSnapshot,
  type V1ChangeRepository,
  type V1RecordChangeInput,
  type V1RecordChangeResult,
} from './v1-change.repository';

function human(userId = 'u1'): Principal {
  return { kind: 'HUMAN', userId, scopes: [] };
}
function agent(userId = 'u2', credentialId = 'c1', scopes: Scope[] = ['change:ack']): Principal {
  return { kind: 'AGENT', userId, agentCredentialId: credentialId, projectId: 'p1', roleIds: ['r1'], scopes };
}

class InMemoryChangeRepo implements V1ChangeRepository {
  events = new Map<string, V1ChangeEventWithRecipients>();
  recipients = new Map<string, V1ChangeRecipientSnapshot>();
  operations = new Map<string, V1OperationRecord>();

  async recordChange(input: V1RecordChangeInput): Promise<V1RecordChangeResult> {
    const eventId = randomUUID();
    const event: V1ChangeEventWithRecipients = {
      id: eventId,
      projectId: input.projectId,
      requirementId: input.requirementId ?? null,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      changedFields: input.changedFields,
      targets: input.targets,
      createdAt: input.operation.now.toISOString(),
      recipients: [],
    };
    for (const r of input.recipients) {
      const rec: V1ChangeRecipientSnapshot = {
        id: randomUUID(),
        projectId: input.projectId,
        eventId,
        userId: r.userId,
        roleId: r.roleId ?? null,
        version: 1,
        ackedAt: null,
        createdAt: input.operation.now.toISOString(),
      };
      this.recipients.set(rec.id, rec);
      event.recipients.push(rec);
    }
    this.events.set(eventId, event);
    this.operations.set(input.operation.key, {
      id: input.operation.id,
      projectScopeKey: input.operation.projectScopeKey,
      principalScopeKey: input.operation.principalScopeKey,
      key: input.operation.key,
      method: input.operation.method,
      route: input.operation.route,
      requestDigest: input.operation.requestDigest,
      resultRefs: { eventId },
      committedAt: input.operation.now,
    });
    return { event, recipients: event.recipients, idempotency: this.operations.get(input.operation.key)! };
  }

  async findEvent(id: string): Promise<V1ChangeEventWithRecipients | null> {
    return this.events.get(id) ?? null;
  }

  async findRecipient(id: string): Promise<V1ChangeRecipientSnapshot | null> {
    return this.recipients.get(id) ?? null;
  }

  async ack(input: V1AckInput): Promise<{ recipient: V1ChangeRecipientSnapshot; idempotency: V1OperationRecord }> {
    const r = this.recipients.get(input.id);
    if (!r) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'CHANGE_RECIPIENT_NOT_FOUND', { recipientId: input.id }, 404);
    if (input.expectedVersion !== undefined && input.expectedVersion !== r.version)
      throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'CHANGE_RECIPIENT_VERSION_CONFLICT', { recipientId: r.id }, 409);
    if (r.ackedAt !== null) {
      const op = this.storeOp(input, r.ackedAt);
      return { recipient: r, idempotency: op };
    }
    r.ackedAt = input.operation.now.toISOString();
    r.version += 1;
    const op = this.storeOp(input, r.ackedAt);
    return { recipient: r, idempotency: op };
  }

  private storeOp(input: V1AckInput, ackedAt: string): V1OperationRecord {
    const op: V1OperationRecord = {
      id: input.operation.id,
      projectScopeKey: input.operation.projectScopeKey,
      principalScopeKey: input.operation.principalScopeKey,
      key: input.operation.key,
      method: input.operation.method,
      route: input.operation.route,
      requestDigest: input.operation.requestDigest,
      resultRefs: { recipientId: input.id, ackedAt },
      committedAt: input.operation.now,
    };
    this.operations.set(input.operation.key, op);
    return op;
  }

  async listRecipients(query: V1ChangeListQuery): Promise<V1ChangeListResult> {
    let rows = [...this.recipients.values()].filter((r) => r.userId === query.userId);
    if (query.projectId) rows = rows.filter((r) => r.projectId === query.projectId);
    if (query.ackedOnly) rows = rows.filter((r) => r.ackedAt !== null);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    if (query.cursor) {
      const idx = rows.findIndex((r) => r.id === query.cursor);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }
}

class InMemoryAuthz implements V1AuthorizationRepository {
  async resolveProjectContext(_p: Principal, projectId: string) {
    return { project: { id: projectId }, membership: { userId: _p.userId, revokedAt: null }, activeRoleIds: ['r1'] };
  }
  async requireScope(p: Principal, _projectId: string, scope: Scope): Promise<void> {
    if (p.kind === 'AGENT' && !p.scopes.includes(scope))
      throw new WorkmeshError(V1_ERROR_CODES.SCOPE_DENIED, 'SCOPE_DENIED', { scope }, 403);
  }
  async findProject(_id: string) {
    return null;
  }
  async findMember(_projectId: string, _userId: string) {
    return null;
  }
  async findActiveRoleAssignments(_projectId: string, _userId: string) {
    return [];
  }
  async findRoleAssignment(_projectId: string, _userId: string, _roleId: string) {
    return null;
  }
  async findGrants(_knowledgeBaseId: string) {
    return [];
  }
  async findKnowledgeBase() {
    return null;
  }
}

class InMemoryIdempotency implements V1IdempotencyRepository {
  constructor(private readonly store: Map<string, V1OperationRecord>) {}
  async findOperation(q: { projectScopeKey: string; principalScopeKey: string; key: string }) {
    return this.store.get(q.key) ?? null;
  }
}

function build(repo: InMemoryChangeRepo, authz: InMemoryAuthz) {
  const idem = new InMemoryIdempotency(repo.operations);
  const service = new V1ChangeService(repo as any, authz as any, idem as any);
  return { service, repo, authz, idem };
}

function ackInput(recipientId: string, key: string, principal: Principal) {
  return {
    idempotencyKey: key,
    expectedVersion: undefined as number | undefined,
    method: 'POST',
    route: `/api/v1/change-recipients/${recipientId}/ack`,
    requestId: 'req-1',
    now: new Date('2026-11-01T00:00:00.000Z'),
    operationId: randomUUID(),
    body: { recipientId },
  };
}

describe('V1ChangeService.ack', () => {
  it('acks a recipient owned by the principal', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    const rec = await seedRecipient(repo, 'p1', 'u1');

    const result = await service.ack(human('u1'), rec.id, ackInput(rec.id, 'k1', human('u1')));
    expect(result.replayed).toBe(false);
    expect(result.recipient.ackedAt).not.toBeNull();
    expect(repo.recipients.get(rec.id)!.ackedAt).not.toBeNull();
  });

  it('returns 404 for a non-existent recipient (no existence leak)', async () => {
    const { service } = build(new InMemoryChangeRepo(), new InMemoryAuthz());
    await expect(service.ack(human('u1'), randomUUID(), ackInput('x', 'k1', human('u1')))).rejects.toMatchObject({
      status: 404,
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('returns 404 when recipient belongs to another user', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    const rec = await seedRecipient(repo, 'p1', 'u-other');
    await expect(service.ack(human('u1'), rec.id, ackInput(rec.id, 'k1', human('u1')))).rejects.toMatchObject({
      status: 404,
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('rejects an AGENT lacking change:ack with 403', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    const rec = await seedRecipient(repo, 'p1', 'u2');
    await expect(service.ack(agent('u2', 'c1', []), rec.id, ackInput(rec.id, 'k1', agent('u2', 'c1', [])))).rejects.toMatchObject({
      status: 403,
      code: V1_ERROR_CODES.SCOPE_DENIED,
    });
  });

  it('replays identical idempotency key (same result, no double ack)', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    const rec = await seedRecipient(repo, 'p1', 'u1');

    const first = await service.ack(human('u1'), rec.id, ackInput(rec.id, 'same-key', human('u1')));
    const second = await service.ack(human('u1'), rec.id, ackInput(rec.id, 'same-key', human('u1')));
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.recipient.ackedAt).toBe(first.recipient.ackedAt);
    expect(repo.recipients.get(rec.id)!.version).toBe(2);
  });

  it('idempotent by state: different key on already-acked returns existing', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    const rec = await seedRecipient(repo, 'p1', 'u1');
    await service.ack(human('u1'), rec.id, ackInput(rec.id, 'k1', human('u1')));
    const again = await service.ack(human('u1'), rec.id, ackInput(rec.id, 'k2', human('u1')));
    expect(again.replayed).toBe(false);
    expect(again.recipient.ackedAt).not.toBeNull();
    expect(repo.recipients.get(rec.id)!.version).toBe(2);
  });
});

describe('V1ChangeService.listRecipients (>100 pagination, no loss)', () => {
  it('returns all 120 recipients across pages of 50 without loss or duplication', async () => {
    const repo = new InMemoryChangeRepo();
    const { service } = build(repo, new InMemoryAuthz());
    for (let i = 0; i < 120; i++) await seedRecipient(repo, 'p1', 'u1');

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await service.listRecipients(human('u1'), { projectId: 'p1', limit: 50, cursor });
      for (const r of res.items) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      cursor = res.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(seen.size).toBe(120);
    expect(pages).toBe(3);
  });
});

async function seedRecipient(repo: InMemoryChangeRepo, projectId: string, userId: string) {
  const res = await repo.recordChange({
    projectId,
    sourceKind: 'REVIEW',
    sourceId: randomUUID(),
    changedFields: ['status'],
    targets: {},
    recipients: [{ userId }],
    operation: {
      id: randomUUID(),
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: `user:${userId}`,
      key: randomUUID(),
      method: 'POST',
      route: '/api/v1/change-events',
      requestDigest: '0'.repeat(64),
      now: new Date('2026-11-01T00:00:00.000Z'),
    },
  });
  return res.recipients[0];
}
