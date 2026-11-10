/** 看板卡片（只读派生自 Task + 当前 Claim + 当前 ArtifactSet）。 */
export interface V1BoardCard {
  taskId: string;
  projectId: string;
  stepKey: string;
  stepDisplayName?: string | null;
  roleId: string;
  /** 人类可读标签；旧调用方可忽略。 */
  requirementId?: string;
  requirementCode?: string;
  requirementTitle?: string;
  roleKey?: string;
  roleTitle?: string;
  responsibleUserEmail?: string;
  claimedUserEmail?: string;
  executionStatus: string;
  workStatus: string | null;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  claimedUserId: string | null;
  claimedAt: string | null;
  generation: number;
}

export const V1_BOARD_COLUMNS = [
  'BACKLOG',
  'ACTIVE',
  'BLOCKED',
  'PAUSED',
  'CANCELLED',
  'DELIVERED',
] as const;
export type V1BoardColumnKey = (typeof V1_BOARD_COLUMNS)[number];
export type V1BoardFilterKind = 'roles' | 'requirements';
export interface V1BoardQuery {
  q?: string;
  roleTitle?: string;
  requirementCode?: string;
  limit?: number;
  cursor?: string | null;
  search?: string;
}
export interface V1BoardReadQuery {
  q: string;
  roleTitle: string;
  requirementCode: string;
  limit: number;
  cursor: string | null;
  search: string;
}
export interface V1BoardSummary {
  total: number;
  matchedTotal: number;
  columns: Array<{ key: V1BoardColumnKey; total: number }>;
  requirementTotal: number;
}
/** Cards are a bounded page; total includes all matches in this column. */
export interface V1BoardColumn {
  key: V1BoardColumnKey;
  total: number;
  cards: V1BoardCard[];
  nextCursor: string | null;
}

export interface V1BoardSnapshot {
  projectId: string;
  queryKey: string;
  summary: V1BoardSummary;
  columns: V1BoardColumn[];
}
export interface V1BoardColumnPage extends V1BoardColumn {
  projectId: string;
  queryKey: string;
}
export interface V1BoardRequirementGroup {
  code: string;
  title: string;
  total: number;
  counts: Record<V1BoardColumnKey, number>;
  roles: string[];
  roleTotal: number;
  rolesNextCursor: string | null;
}
export interface V1BoardRequirementPage {
  projectId: string;
  queryKey: string;
  summary: V1BoardSummary;
  items: V1BoardRequirementGroup[];
  nextCursor: string | null;
}
export interface V1BoardFilterPage {
  projectId: string;
  queryKey: string;
  total: number;
  items: Array<{ value: string; label: string }>;
  nextCursor: string | null;
}

export const V1_BOARD_REPOSITORY = Symbol('V1_BOARD_REPOSITORY');

export interface V1BoardRepository {
  snapshot(projectId: string, query: V1BoardReadQuery): Promise<V1BoardSnapshot>;
  column(
    projectId: string,
    column: V1BoardColumnKey,
    query: V1BoardReadQuery,
  ): Promise<V1BoardColumnPage>;
  requirements(projectId: string, query: V1BoardReadQuery): Promise<V1BoardRequirementPage>;
  filters(
    projectId: string,
    kind: V1BoardFilterKind,
    query: V1BoardReadQuery,
  ): Promise<V1BoardFilterPage>;
}
