import { Inject, Injectable } from '@nestjs/common';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { normalizeBoardQuery, decodeBoardCursor } from './v1-board.pagination';
import {
  V1_BOARD_REPOSITORY,
  V1_BOARD_COLUMNS,
  type V1BoardColumnKey,
  type V1BoardFilterKind,
  type V1BoardQuery,
  type V1BoardRepository,
} from './v1-board.repository';

@Injectable()
export class V1BoardService {
  constructor(
    @Inject(V1_BOARD_REPOSITORY)
    private readonly repository: V1BoardRepository,
    private readonly authorization: V1AuthorizationService,
  ) {}

  private async authorize(principal: Principal, projectId: string) {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    await this.authorization.requireScope(principal, projectId, 'task:read');
  }
  async board(principal: Principal, projectId: string, input: V1BoardQuery = {}) {
    await this.authorize(principal, projectId);
    const query = normalizeBoardQuery(input);
    if (query.cursor)
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'BOARD_CURSOR_REQUIRES_VIEW',
        undefined,
        400,
      );
    return this.repository.snapshot(projectId, query);
  }
  async column(principal: Principal, projectId: string, column: string, input: V1BoardQuery = {}) {
    await this.authorize(principal, projectId);
    if (!V1_BOARD_COLUMNS.includes(column as V1BoardColumnKey))
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'BOARD_COLUMN_INVALID',
        undefined,
        400,
      );
    const query = normalizeBoardQuery(input);
    decodeBoardCursor(projectId, query, `column:${column}`);
    return this.repository.column(projectId, column as V1BoardColumnKey, query);
  }
  async requirements(principal: Principal, projectId: string, input: V1BoardQuery = {}) {
    await this.authorize(principal, projectId);
    const query = normalizeBoardQuery(input);
    decodeBoardCursor(projectId, query, 'requirements');
    return this.repository.requirements(projectId, query);
  }
  async filters(principal: Principal, projectId: string, kind: string, input: V1BoardQuery = {}) {
    await this.authorize(principal, projectId);
    if (kind !== 'roles' && kind !== 'requirements')
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'BOARD_FILTER_KIND_INVALID',
        undefined,
        400,
      );
    const query = normalizeBoardQuery(input, 50);
    decodeBoardCursor(projectId, query, `filters:${kind}`);
    return this.repository.filters(projectId, kind as V1BoardFilterKind, query);
  }
}
