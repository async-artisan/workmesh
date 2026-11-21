import type { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { boundEvidenceIds } from '../reviews/v1-review-code-evidence';
import type {
  TrustCodeEvidence,
  TrustData,
  TrustSet,
  TrustSnapshot,
} from './requirement-trust-chain';

type Client = Prisma.TransactionClient;
export const trustStampSelect = {
  kind: true,
  user: { select: { id: true, email: true } },
} as const;

/** Batch current and historical delivery links; no payload bytes or credential/ticket secrets leave the reader. */
export async function readRequirementDeliveryLinks(
  tx: Client,
  projectId: string,
  taskIds: string[],
): Promise<Pick<TrustData, 'sets' | 'snapshots' | 'evidence' | 'repositories'>> {
  const sets: TrustSet[] = taskIds.length
    ? await tx.artifactSet.findMany({
        where: { projectId, taskId: { in: taskIds } },
        select: {
          id: true,
          taskId: true,
          taskGeneration: true,
          snapshotId: true,
          workflowDefinitionRevisionId: true,
          manifestDigest: true,
          createdAt: true,
          createdByStamp: { select: trustStampSelect },
          artifacts: { select: { storage: true, commitSha: true, projectRepositoryId: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })
    : [];
  const snapshotIds = [...new Set(sets.map((set) => set.snapshotId))];
  const setIds = sets.map((set) => set.id);
  const evidenceSelect = {
    id: true,
    artifactSetId: true,
    preparedSecretHash: true,
    preparedExpiresAt: true,
    preparedEvidenceId: true,
    ticketGeneration: true,
    state: true,
    reviewerKind: true,
    repositoryId: true,
    headSha: true,
    commitSha: true,
    changeRequestId: true,
    reviewerExternalId: true,
    authorExternalId: true,
    submittedAt: true,
    createdAt: true,
    receipt: { select: { projectId: true, source: true, signatureValid: true, status: true } },
  } as const;
  const [snapshots, tickets] = await Promise.all([
    snapshotIds.length
      ? tx.contextSnapshot.findMany({
          where: { projectId, id: { in: snapshotIds } },
          select: {
            id: true,
            taskId: true,
            taskGeneration: true,
            requirementId: true,
            requirementGeneration: true,
            workflowDefinitionRevisionId: true,
            manifest: true,
          },
        })
      : Promise.resolve([] as TrustSnapshot[]),
    setIds.length
      ? tx.codeReviewEvidence.findMany({
          where: { projectId, artifactSetId: { in: setIds }, preparedSecretHash: { not: null } },
          select: evidenceSelect,
        })
      : Promise.resolve([]),
  ]);
  const ids = boundEvidenceIds(tickets);
  const bound = ids.length
    ? await tx.codeReviewEvidence.findMany({
        where: { projectId, id: { in: ids }, preparedSecretHash: null },
        select: evidenceSelect,
      })
    : [];
  const prs = [
    ...new Map(
      bound.map((row) => [
        `${row.repositoryId}:${row.changeRequestId}`,
        { repositoryId: row.repositoryId, changeRequestId: row.changeRequestId },
      ]),
    ).values(),
  ];
  // A later opinion on the same PR can supersede an old approval even on a different head.
  const opinions = prs.length
    ? await tx.codeReviewEvidence.findMany({
        where: { projectId, preparedSecretHash: null, OR: prs },
        select: evidenceSelect,
      })
    : [];
  const repositoryIds = [
    ...new Set(
      sets.flatMap((set) =>
        set.artifacts.flatMap((artifact) =>
          artifact.projectRepositoryId ? [artifact.projectRepositoryId] : [],
        ),
      ),
    ),
  ];
  const repositories = repositoryIds.length
    ? await tx.projectRepository.findMany({
        where: { projectId, id: { in: repositoryIds } },
        select: { id: true, externalId: true, archivedAt: true, identityMode: true, adapter: true },
      })
    : [];
  const evidence: TrustCodeEvidence[] = [
    ...new Map([...tickets, ...bound, ...opinions].map((row) => [row.id, row])).values(),
  ].map((row) => ({
    ...row,
    receipt:
      row.receipt?.projectId === projectId && row.receipt.source === 'GITHUB'
        ? { signatureValid: row.receipt.signatureValid, status: row.receipt.status }
        : null,
  }));
  return { sets, snapshots, evidence, repositories };
}
