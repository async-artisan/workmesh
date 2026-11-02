import { Inject, Injectable } from '@nestjs/common';
import { V1AuthorizationService } from '../auth/v1-authorization';
import type { Principal } from '@workmesh/shared';
import {
  V1_BOARD_REPOSITORY,
  type V1BoardCard,
  type V1BoardColumn,
  type V1BoardSnapshot,
} from './v1-board.repository';

const COLUMN_ORDER = ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'DELIVERED'] as const;

@Injectable()
export class V1BoardService {
  constructor(
    @Inject(V1_BOARD_REPOSITORY)
    private readonly repository: import('./v1-board.repository').V1BoardRepository,
    private readonly authorization: V1AuthorizationService,
  ) {}

  /** 只读派生看板：按任务当前认领/工作态/交付态分组为固定列。 */
  async board(principal: Principal, projectId: string): Promise<V1BoardSnapshot> {
    await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'task:read');

    const cards = await this.repository.listCards(projectId);
    return { projectId, columns: this.toColumns(cards) };
  }

  private toColumns(cards: V1BoardCard[]): V1BoardColumn[] {
    const buckets: Record<string, V1BoardCard[]> = {};
    for (const key of COLUMN_ORDER) buckets[key] = [];
    for (const card of cards) {
      const key = this.columnOf(card);
      buckets[key].push(card);
    }
    return COLUMN_ORDER.map((key) => ({ key, cards: buckets[key] }));
  }

  private columnOf(card: V1BoardCard): string {
    if (card.currentArtifactSetId) return 'DELIVERED';
    if (!card.currentClaimId) return 'BACKLOG';
    switch (card.workStatus) {
      case 'BLOCKED':
        return 'BLOCKED';
      case 'PAUSED':
        return 'PAUSED';
      case 'ACTIVE':
      default:
        return 'ACTIVE';
    }
  }
}
