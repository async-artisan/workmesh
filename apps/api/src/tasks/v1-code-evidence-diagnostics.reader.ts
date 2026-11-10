import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { PrismaService } from '../prisma/prisma.service';
import { codeEvidenceDiagnosticsOf } from './v1-code-evidence-diagnostics';

const LIMIT = 1000;

/** Repeatable-read explanation; never consumes a ticket or changes an approval. */
export async function readCodeEvidenceDiagnostics(
  prisma: PrismaService,
  projectId: string,
  artifactSetId: string,
) {
  return prisma.$transaction(
    (tx) => readCodeEvidenceDiagnosticsInTransaction(tx, projectId, artifactSetId),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function readCodeEvidenceDiagnosticsInTransaction(
  tx: Pick<
    Prisma.TransactionClient,
    'artifactSet' | 'projectRepository' | 'codeReviewEvidence' | 'webhookReceipt'
  >,
  projectId: string,
  artifactSetId: string,
  taskId?: string,
) {
  const set = await tx.artifactSet.findFirst({
    where: { id: artifactSetId, projectId, ...(taskId ? { taskId } : {}) },
    select: {
      taskGeneration: true,
      artifacts: {
        where: { projectId },
        select: { id: true, storage: true, commitSha: true, projectRepositoryId: true },
      },
      task: {
        select: {
          generation: true,
          currentArtifactSetId: true,
          workStatus: true,
          instance: { select: { retiredAt: true } },
        },
      },
    },
  });
  if (!set) return null;
  const repositories = await tx.projectRepository.findMany({
    where: {
      projectId,
      id: {
        in: set.artifacts.flatMap((row) =>
          row.projectRepositoryId ? [row.projectRepositoryId] : [],
        ),
      },
    },
    select: {
      id: true,
      owner: true,
      name: true,
      externalId: true,
      identityMode: true,
      adapter: true,
      archivedAt: true,
    },
  });
  const ticketRows = await tx.codeReviewEvidence.findMany({
    where: { projectId, artifactSetId, preparedSecretHash: { not: null } },
    select: {
      id: true,
      repositoryId: true,
      changeRequestId: true,
      headSha: true,
      ticketGeneration: true,
      preparedEvidenceId: true,
      preparedSecretHash: true,
      preparedExpiresAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LIMIT + 1,
  });
  const tickets = ticketRows
    .slice(0, LIMIT)
    .map(({ preparedSecretHash, ...row }) => ({ ...row, hasSecret: preparedSecretHash !== null }));
  const pairs = set.artifacts.flatMap((artifact) => {
    const repository = repositories.find((row) => row.id === artifact.projectRepositoryId);
    return repository?.identityMode === 'PROVIDER' &&
      repository.adapter?.toUpperCase() === 'GITHUB' &&
      repository.externalId &&
      artifact.commitSha
      ? [{ repositoryId: repository.externalId, headSha: artifact.commitSha }]
      : [];
  });
  const evidenceSelect = {
    id: true,
    repositoryId: true,
    changeRequestId: true,
    headSha: true,
    commitSha: true,
    reviewerExternalId: true,
    authorExternalId: true,
    reviewerKind: true,
    state: true,
    submittedAt: true,
    createdAt: true,
    receiptId: true,
  } as const;
  const linkedIds = tickets.flatMap((row) =>
    row.preparedEvidenceId ? [row.preparedEvidenceId] : [],
  );
  const initial =
    pairs.length || linkedIds.length
      ? await tx.codeReviewEvidence.findMany({
          where: { projectId, preparedSecretHash: null, OR: [...pairs, { id: { in: linkedIds } }] },
          select: evidenceSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIMIT + 1,
        })
      : [];
  // Include later opinions on every associated PR, including a newer head.
  const prPairs = [
    ...new Map(
      initial
        .slice(0, LIMIT)
        .map((row) => [
          `${row.repositoryId}:${row.changeRequestId}`,
          { repositoryId: row.repositoryId, changeRequestId: row.changeRequestId },
        ]),
    ).values(),
  ];
  const opinions = prPairs.length
    ? await tx.codeReviewEvidence.findMany({
        where: { projectId, preparedSecretHash: null, OR: prPairs },
        select: evidenceSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT + 1,
      })
    : [];
  const evidence = [
    ...new Map(
      [...initial.slice(0, LIMIT), ...opinions.slice(0, LIMIT)].map((row) => [row.id, row]),
    ).values(),
  ];
  const receipts = await tx.webhookReceipt.findMany({
    where: {
      projectId,
      source: 'GITHUB',
      id: { in: [...new Set(evidence.flatMap((row) => (row.receiptId ? [row.receiptId] : [])))] },
    },
    select: {
      id: true,
      signatureValid: true,
      eventType: true,
      status: true,
      receivedAt: true,
      processedAt: true,
    },
  });
  return codeEvidenceDiagnosticsOf({
    set,
    task: { ...set.task, retired: set.task.instance.retiredAt !== null },
    artifactSetId,
    repositories,
    evidence,
    tickets,
    receipts,
    complete: ticketRows.length <= LIMIT && initial.length <= LIMIT && opinions.length <= LIMIT,
  });
}
