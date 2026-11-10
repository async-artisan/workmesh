import type { CodeEvidenceDiagnostics } from '@workmesh/shared';
import { codeEvidenceReviewReasons } from './v1-code-evidence-provenance';

export function isCodeEvidenceDiagnosticsAcceptable(value: CodeEvidenceDiagnostics): boolean {
  const consumed = new Set(
    value.references.flatMap((reference) =>
      reference.tickets.filter((ticket) => ticket.state === 'CONSUMED').map((ticket) => ticket.id),
    ),
  );
  return (
    value.complete &&
    value.currentBinding === 'CURRENT' &&
    value.references.length > 0 &&
    value.references.every((reference) => reference.status === 'BOUND') &&
    [...consumed].every((id) =>
      value.references.some((reference) =>
        reference.tickets.some(
          (ticket) =>
            ticket.id === id &&
            ticket.state === 'CONSUMED' &&
            ticket.matchesReference &&
            ticket.matchesGeneration,
        ),
      ),
    )
  );
}

export interface CodeEvidenceDiagnosticRows {
  set: {
    taskGeneration: number;
    artifacts: Array<{
      id: string;
      storage: string;
      commitSha: string | null;
      projectRepositoryId: string | null;
    }>;
  };
  task: {
    generation: number;
    currentArtifactSetId: string | null;
    workStatus: string;
    retired: boolean;
  };
  artifactSetId: string;
  repositories: Array<{
    id: string;
    owner: string;
    name: string;
    externalId: string | null;
    identityMode: string;
    adapter: string | null;
    archivedAt: Date | null;
  }>;
  evidence: Array<{
    id: string;
    repositoryId: string;
    changeRequestId: string;
    headSha: string;
    commitSha: string | null;
    reviewerExternalId: string;
    authorExternalId: string;
    reviewerKind: string;
    state: string;
    submittedAt: Date | null;
    createdAt: Date;
    receiptId: string | null;
  }>;
  tickets: Array<{
    id: string;
    repositoryId: string;
    changeRequestId: string;
    headSha: string;
    ticketGeneration: number | null;
    preparedEvidenceId: string | null;
    hasSecret: boolean;
    preparedExpiresAt: Date | null;
  }>;
  receipts: Array<{
    id: string;
    signatureValid: boolean;
    eventType: string;
    status: string;
    receivedAt: Date;
    processedAt: Date | null;
  }>;
  complete: boolean;
}

export function codeEvidenceDiagnosticsOf(
  input: CodeEvidenceDiagnosticRows,
  now = new Date(),
): CodeEvidenceDiagnostics {
  const currentBinding =
    input.task.retired || input.task.workStatus === 'CANCELLED'
      ? 'INACTIVE'
      : input.set.taskGeneration !== input.task.generation ||
          input.task.currentArtifactSetId !== input.artifactSetId
        ? 'HISTORICAL'
        : 'CURRENT';
  const receiptById = new Map(input.receipts.map((row) => [row.id, row]));
  return {
    checkedAt: now.toISOString(),
    complete: input.complete,
    currentBinding,
    taskGeneration: input.set.taskGeneration,
    currentTaskGeneration: input.task.generation,
    signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
    references: input.set.artifacts
      .filter((artifact) => artifact.storage === 'GIT_REF' || artifact.commitSha !== null)
      .map((artifact) => {
        const repository = input.repositories.find(
          (row) => row.id === artifact.projectRepositoryId,
        );
        const repoEvidence = input.evidence.filter(
          (row) => row.repositoryId === repository?.externalId,
        );
        const exactEvidence = repoEvidence.filter((row) => row.headSha === artifact.commitSha);
        const provenanceReviews = repoEvidence.map((row) => ({
          ...row,
          receipt: row.receiptId ? (receiptById.get(row.receiptId) ?? null) : null,
        }));
        const reasonsOf = (row: CodeEvidenceDiagnosticRows['evidence'][number]) =>
          codeEvidenceReviewReasons(
            { ...row, receipt: row.receiptId ? (receiptById.get(row.receiptId) ?? null) : null },
            provenanceReviews,
            { repositoryId: repository?.externalId ?? '', headSha: artifact.commitSha ?? '' },
          );
        const qualifying = exactEvidence.filter((row) => reasonsOf(row).length === 0);
        const tickets = input.tickets.map((row) => ({
          id: row.id,
          evidenceId: row.preparedEvidenceId,
          repositoryId: row.repositoryId,
          changeRequestId: row.changeRequestId,
          headSha: row.headSha,
          generation: row.ticketGeneration,
          state:
            !row.hasSecret || !row.preparedEvidenceId
              ? ('INVALID' as const)
              : row.preparedExpiresAt === null
                ? ('CONSUMED' as const)
                : row.preparedExpiresAt.getTime() <= now.getTime()
                  ? ('EXPIRED' as const)
                  : ('LIVE' as const),
          matchesReference:
            row.repositoryId === repository?.externalId &&
            row.headSha === artifact.commitSha &&
            qualifying.some(
              (item) =>
                item.id === row.preparedEvidenceId && item.changeRequestId === row.changeRequestId,
            ),
          matchesGeneration:
            row.ticketGeneration === input.set.taskGeneration &&
            row.ticketGeneration === input.task.generation,
        }));
        const matchingTickets = tickets.filter(
          (row) => row.matchesReference && row.matchesGeneration,
        );
        const deliveries = [
          ...new Set(repoEvidence.flatMap((row) => (row.receiptId ? [row.receiptId] : []))),
        ].flatMap((id) => {
          const row = receiptById.get(id);
          return row
            ? [
                {
                  id: row.id,
                  eventType: row.eventType,
                  status: row.status,
                  signatureValid: row.signatureValid,
                  receivedAt: row.receivedAt.toISOString(),
                  processedAt: row.processedAt?.toISOString() ?? null,
                },
              ]
            : [];
        });
        let status: CodeEvidenceDiagnostics['references'][number]['status'];
        if (currentBinding !== 'CURRENT') status = 'HISTORICAL';
        else if (
          !repository ||
          repository.archivedAt ||
          repository.identityMode !== 'PROVIDER' ||
          repository.adapter?.toUpperCase() !== 'GITHUB' ||
          !repository.externalId
        )
          status = 'REPOSITORY_UNRESOLVED';
        else if (!input.complete) status = 'INCOMPLETE';
        else if (!exactEvidence.length && repoEvidence.length) status = 'SHA_MISMATCH';
        else if (!exactEvidence.length && tickets.length) status = 'TICKET_STALE';
        else if (!deliveries.length) status = 'NO_ASSOCIATED_DELIVERY';
        else if (!qualifying.length) status = 'REVIEW_NOT_QUALIFYING';
        else if (matchingTickets.some((row) => row.state === 'CONSUMED')) status = 'BOUND';
        else if (matchingTickets.some((row) => row.state === 'LIVE')) status = 'TICKET_LIVE';
        else if (matchingTickets.some((row) => row.state === 'EXPIRED')) status = 'TICKET_EXPIRED';
        else if (tickets.length) status = 'TICKET_STALE';
        else status = 'TICKET_MISSING';
        return {
          artifactId: artifact.id,
          projectRepositoryId: artifact.projectRepositoryId,
          commitSha: artifact.commitSha,
          repository: repository
            ? {
                owner: repository.owner,
                name: repository.name,
                externalId: repository.externalId,
                identityMode: repository.identityMode,
                adapter: repository.adapter,
                archived: !!repository.archivedAt,
              }
            : null,
          status,
          deliveries,
          reviews: repoEvidence.map((row) => ({
            id: row.id,
            changeRequestId: row.changeRequestId,
            headSha: row.headSha,
            commitSha: row.commitSha,
            reviewerExternalId: row.reviewerExternalId,
            authorExternalId: row.authorExternalId,
            reviewerKind: row.reviewerKind,
            state: row.state,
            submittedAt: row.submittedAt?.toISOString() ?? null,
            reasons: reasonsOf(row),
          })),
          tickets,
        };
      }),
  };
}
