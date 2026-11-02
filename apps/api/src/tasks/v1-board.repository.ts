/** 看板卡片（只读派生自 Task + 当前 Claim + 当前 ArtifactSet）。 */
export interface V1BoardCard {
  taskId: string;
  projectId: string;
  stepKey: string;
  roleId: string;
  executionStatus: string;
  workStatus: string | null;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  claimedUserId: string | null;
  claimedAt: string | null;
  generation: number;
}

/** 看板列：固定顺序的派生分组。 */
export interface V1BoardColumn {
  key: string;
  cards: V1BoardCard[];
}

export interface V1BoardSnapshot {
  projectId: string;
  columns: V1BoardColumn[];
}

export const V1_BOARD_REPOSITORY = Symbol('V1_BOARD_REPOSITORY');

export interface V1BoardRepository {
  /** 读取项目全部任务及其认领/交付派生信息（只读，无写入）。 */
  listCards(projectId: string): Promise<V1BoardCard[]>;
}
