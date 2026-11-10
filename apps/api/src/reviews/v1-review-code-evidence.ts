import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { needsCodeEvidence } from './v1-review-policy';
import type { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { readCodeEvidenceDiagnosticsInTransaction } from '../tasks/v1-code-evidence-diagnostics.reader';
import { isCodeEvidenceDiagnosticsAcceptable } from '../tasks/v1-code-evidence-diagnostics';

/** 票据行携带的绑定信息；占位行本身不是证据本体。 */
export type CodeEvidenceTicketRow = {
  preparedSecretHash: string | null;
  preparedExpiresAt: Date | null;
  preparedEvidenceId: string | null;
};

/**
 * 从某个工件集下的证据行里解析出「真正参与验收」的证据 id。
 *
 * 背景：`prepare-code-evidence` 会在工件集下建一条 PENDING 占位行（带 preparedSecretHash），
 * 真实的人类批准证据由 webhook 写入、不带 artifactSetId。若直接按 artifactSetId 取证据，
 * 只会取到占位行 → 恒不通过。正确口径是：以「已消费的票据」为凭据，解析它引用的那一条真实证据。
 *
 * 三条排除规则：
 * - `preparedSecretHash` 为空 → 不是票据行（真实证据行），不当凭据；
 * - `preparedExpiresAt` 非空 → 票据未消费或已过期，Agent 尚未认领，不算绑定；
 * - `preparedEvidenceId` 为空 → 票据没有指向任何证据。
 */
export function boundEvidenceIds(rows: readonly CodeEvidenceTicketRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.preparedSecretHash === null) continue;
    if (row.preparedExpiresAt !== null) continue;
    if (row.preparedEvidenceId === null) continue;
    if (!ids.includes(row.preparedEvidenceId)) ids.push(row.preparedEvidenceId);
  }
  return ids;
}

/** 只依赖 artifact / codeReviewEvidence 两个委托，便于在单测里用假事务覆盖。 */
export type CodeEvidenceGateTx = Pick<
  Prisma.TransactionClient,
  'artifact' | 'artifactSet' | 'projectRepository' | 'codeReviewEvidence' | 'webhookReceipt'
>;

/**
 * 验收闸门：交付集声称包含真实代码时，必须有经人类批准的 PR 评审证据。
 *
 * 只有「真的指向代码」的交付才要求证据：GIT_REF，或带 commitSha 的工件。
 * 纯 HOSTED 的 IMPL（实现说明、变更清单）没有可评审的提交，不受此约束。
 */
export async function assertCodeEvidenceAcceptable(input: {
  tx: CodeEvidenceGateTx;
  projectId: string;
  artifactSetId: string;
  taskId: string;
}): Promise<void> {
  const artifacts = await input.tx.artifact.findMany({
    where: { artifactSetId: input.artifactSetId, projectId: input.projectId },
    select: { storage: true, commitSha: true },
  });
  if (!needsCodeEvidence(artifacts)) return;

  const diagnostics = await readCodeEvidenceDiagnosticsInTransaction(
    input.tx,
    input.projectId,
    input.artifactSetId,
    input.taskId,
  );
  if (diagnostics && isCodeEvidenceDiagnosticsAcceptable(diagnostics)) return;

  throw new WorkmeshError(
    V1_ERROR_CODES.CODE_EVIDENCE_MISSING,
    'CODE_REVIEW_EVIDENCE_MISSING',
    {
      taskId: input.taskId,
      artifactSetId: input.artifactSetId,
      reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
      currentBinding: diagnostics?.currentBinding ?? null,
      complete: diagnostics?.complete ?? false,
      references:
        diagnostics?.references.map((reference) => ({
          artifactId: reference.artifactId,
          status: reference.status,
        })) ?? [],
    },
    422,
  );
}
