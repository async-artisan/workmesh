import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, type Principal, type Scope } from '@workmesh/shared';
import type { V1AuthorizationRepository } from '../auth/v1-authorization';
import { V1BoardService } from './v1-board.service';
import {
  type V1BoardCard,
  type V1BoardRepository,
} from './v1-board.repository';

function human(userId = 'u1'): Principal {
  return { kind: 'HUMAN', userId, scopes: [] };
}
function agent(userId = 'u2', scopes: Scope[] = ['task:read']): Principal {
  return { kind: 'AGENT', userId, agentCredentialId: 'c1', projectId: 'p1', roleIds: ['r1'], scopes };
}

function card(over: Partial<V1BoardCard> = {}): V1BoardCard {
  return {
    taskId: randomUUID(),
    projectId: 'p1',
    stepKey: 'DEV',
    roleId: 'r1',
    executionStatus: 'IN_PROGRESS',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentArtifactSetId: null,
    claimedUserId: null,
    claimedAt: null,
    generation: 1,
    ...over,
  };
}

class InMemoryBoardRepo implements V1BoardRepository {
  constructor(private readonly cards: V1BoardCard[]) {}
  async listCards(_projectId: string): Promise<V1BoardCard[]> {
    return this.cards;
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
  async findProject() { return null; }
  async findMember() { return null; }
  async findActiveRoleAssignments() { return []; }
  async findRoleAssignment() { return null; }
  async findGrants() { return []; }
  async findKnowledgeBase() { return null; }
}

function build(repo: InMemoryBoardRepo) {
  const authz = new InMemoryAuthz();
  const service = new V1BoardService(repo as any, authz as any);
  return { service, authz };
}

describe('V1BoardService.board', () => {
  it('groups tasks into fixed columns by claim/work/delivery state', async () => {
    const repo = new InMemoryBoardRepo([
      card(), // no claim -> BACKLOG
      card({ currentClaimId: 'c1', workStatus: 'ACTIVE', claimedUserId: 'u1' }), // ACTIVE
      card({ currentClaimId: 'c2', workStatus: 'BLOCKED', claimedUserId: 'u1' }), // BLOCKED
      card({ currentClaimId: 'c3', workStatus: 'PAUSED', claimedUserId: 'u1' }), // PAUSED
      card({ currentClaimId: 'c4', currentArtifactSetId: 'a1', claimedUserId: 'u1' }), // DELIVERED
    ]);
    const { service } = build(repo);
    const board = await service.board(human('u1'), 'p1');
    const byKey = Object.fromEntries(board.columns.map((c) => [c.key, c.cards.length]));
    expect(byKey).toEqual({ BACKLOG: 1, ACTIVE: 1, BLOCKED: 1, PAUSED: 1, DELIVERED: 1 });
    expect(board.columns).toHaveLength(5);
  });

  it('rejects an AGENT lacking task:read with 403', async () => {
    const repo = new InMemoryBoardRepo([card()]);
    const { service } = build(repo);
    await expect(service.board(agent('u2', []), 'p1')).rejects.toMatchObject({
      status: 403,
      code: 'SCOPE_DENIED',
    });
  });
});
