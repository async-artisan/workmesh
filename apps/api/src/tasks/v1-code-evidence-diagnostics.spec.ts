import { describe, expect, it, vi } from 'vitest';
import {
  codeEvidenceDiagnosticsOf,
  type CodeEvidenceDiagnosticRows,
} from './v1-code-evidence-diagnostics';
import { V1ArtifactService } from './v1-artifact.service';

const now = new Date('2026-11-10T00:00:00Z');
function fixture(): CodeEvidenceDiagnosticRows {
  return {
    artifactSetId: 'set',
    complete: true,
    set: {
      taskGeneration: 2,
      artifacts: [
        {
          id: 'artifact',
          storage: 'GIT_REF',
          commitSha: 'a'.repeat(40),
          projectRepositoryId: 'repo',
        },
      ],
    },
    task: { generation: 2, currentArtifactSetId: 'set', workStatus: 'ACTIVE', retired: false },
    repositories: [
      {
        id: 'repo',
        owner: 'team',
        name: 'code',
        externalId: 'provider-1',
        adapter: 'GITHUB',
        identityMode: 'PROVIDER',
        archivedAt: null,
      },
    ],
    receipts: [
      {
        id: 'receipt',
        signatureValid: true,
        eventType: 'pull_request',
        status: 'PROCESSED',
        receivedAt: now,
        processedAt: now,
      },
    ],
    evidence: [
      {
        id: 'review',
        repositoryId: 'provider-1',
        changeRequestId: '10',
        headSha: 'a'.repeat(40),
        commitSha: 'a'.repeat(40),
        authorExternalId: 'author',
        reviewerExternalId: 'reviewer',
        reviewerKind: 'USER',
        state: 'APPROVED',
        submittedAt: now,
        createdAt: now,
        receiptId: 'receipt',
      },
    ],
    tickets: [],
  };
}
function status(input: CodeEvidenceDiagnosticRows) {
  return codeEvidenceDiagnosticsOf(input, now).references[0];
}
function ticket(input: CodeEvidenceDiagnosticRows, expiresAt: Date | null = null) {
  input.tickets.push({
    id: 'ticket',
    repositoryId: 'provider-1',
    changeRequestId: '10',
    headSha: 'a'.repeat(40),
    ticketGeneration: 2,
    preparedEvidenceId: 'review',
    hasSecret: true,
    preparedExpiresAt: expiresAt,
  });
}

describe('code evidence provenance diagnostics', () => {
  it('distinguishes missing ticket, live, expired, consumed and stale generation', () => {
    const input = fixture();
    expect(status(input).status).toBe('TICKET_MISSING');
    ticket(input, new Date(now.getTime() + 1000));
    expect(status(input).status).toBe('TICKET_LIVE');
    input.tickets[0].preparedExpiresAt = now;
    expect(status(input).status).toBe('TICKET_EXPIRED');
    input.tickets[0].preparedExpiresAt = null;
    expect(status(input)).toMatchObject({
      status: 'BOUND',
      tickets: [{ state: 'CONSUMED', matchesGeneration: true, matchesReference: true }],
    });
    input.tickets[0].ticketGeneration = 1;
    expect(status(input).status).toBe('TICKET_STALE');
  });
  it('explains absent association without attributing signature failures', () => {
    const input = fixture();
    input.evidence = [];
    input.receipts = [];
    expect(status(input)).toMatchObject({
      status: 'NO_ASSOCIATED_DELIVERY',
      deliveries: [],
      reviews: [],
    });
    expect(codeEvidenceDiagnosticsOf(input).signaturePolicy).toBe('REJECTED_BEFORE_RECEIPT');
  });
  it.each([
    ['BOT_REVIEW', { reviewerKind: 'BOT' }],
    ['OTHER_USER_APPROVAL_REQUIRED', { reviewerExternalId: 'author' }],
    ['HUMAN_APPROVAL_REQUIRED', { state: 'CHANGES_REQUESTED' }],
    ['SHA_MISMATCH', { commitSha: 'b'.repeat(40) }],
  ])('explains %s without treating approval alone as provenance', (reason, patch) => {
    const input = fixture();
    Object.assign(input.evidence[0], patch);
    ticket(input);
    expect(status(input)).toMatchObject({
      status: 'REVIEW_NOT_QUALIFYING',
      reviews: [{ reasons: expect.arrayContaining([reason]) }],
    });
  });
  it('recognizes later changes requested on a newer PR head', () => {
    const input = fixture();
    ticket(input);
    input.evidence.push({
      ...input.evidence[0],
      id: 'new',
      state: 'CHANGES_REQUESTED',
      headSha: 'b'.repeat(40),
      commitSha: 'b'.repeat(40),
      submittedAt: new Date(now.getTime() + 1000),
    });
    expect(status(input)).toMatchObject({
      status: 'REVIEW_NOT_QUALIFYING',
      reviews: expect.arrayContaining([
        expect.objectContaining({
          id: 'review',
          reasons: expect.arrayContaining(['SUPERSEDED_REVIEW', 'CHANGES_REQUESTED_ACTIVE']),
        }),
      ]),
    });
  });
  it('keeps other repository and SHA tickets visible as stale, not bound', () => {
    const input = fixture();
    ticket(input);
    input.tickets[0].repositoryId = 'other-repository';
    expect(status(input)).toMatchObject({
      status: 'TICKET_STALE',
      tickets: [{ repositoryId: 'other-repository', matchesReference: false }],
    });
    input.evidence[0].headSha = 'b'.repeat(40);
    expect(status(input).status).toBe('SHA_MISMATCH');
  });
  it('does not call a partial query complete or treat old and retired sets as current', () => {
    const input = fixture();
    ticket(input);
    input.complete = false;
    expect(status(input).status).toBe('INCOMPLETE');
    input.complete = true;
    input.task.generation = 3;
    expect(codeEvidenceDiagnosticsOf(input, now)).toMatchObject({
      currentBinding: 'HISTORICAL',
      references: [{ status: 'HISTORICAL' }],
    });
    input.task.retired = true;
    expect(codeEvidenceDiagnosticsOf(input, now).currentBinding).toBe('INACTIVE');
  });
  it('requires a provider repository and signed processed associated receipt', () => {
    const input = fixture();
    input.repositories[0].identityMode = 'DECLARED';
    expect(status(input).status).toBe('REPOSITORY_UNRESOLVED');
    input.repositories[0].identityMode = 'PROVIDER';
    input.receipts[0].status = 'EVIDENCE_INVALID';
    expect(status(input)).toMatchObject({
      status: 'REVIEW_NOT_QUALIFYING',
      reviews: [{ reasons: ['DELIVERY_NOT_PROCESSED'] }],
    });
  });
});

describe('artifact diagnostic authorization', () => {
  function setup() {
    const diagnostics = codeEvidenceDiagnosticsOf(fixture(), now);
    const repository = {
      findArtifactSet: vi.fn().mockResolvedValue({ id: 'set', taskId: 'task', artifacts: [] }),
      findCodeReviewEvidence: vi.fn().mockResolvedValue([]),
      findCodeReviewDiagnostics: vi.fn().mockResolvedValue(diagnostics),
    };
    const authorization = { resolveProjectContext: vi.fn().mockResolvedValue({}) };
    const service = new V1ArtifactService(
      repository as any,
      { findTask: vi.fn().mockResolvedValue({ projectId: 'project' }) } as any,
      authorization as any,
      {} as any,
    );
    return {
      service,
      repository,
      authorization,
      principal: { kind: 'HUMAN', userId: 'user', scopes: [] } as const,
    };
  }
  it('returns diagnostics through scoped read and preserves actual gate result', async () => {
    const { service, repository, authorization, principal } = setup();
    expect(await service.getArtifactSet(principal, 'set')).toMatchObject({
      codeReview: { acceptable: true, diagnostics: { references: [{ status: 'TICKET_MISSING' }] } },
    });
    expect(repository.findCodeReviewDiagnostics).toHaveBeenCalledWith('project', 'set');
    expect(authorization.resolveProjectContext).toHaveBeenCalledTimes(2);
  });
  it('reads no diagnostics before authorization and refuses a revoked read', async () => {
    const { service, repository, authorization, principal } = setup();
    authorization.resolveProjectContext.mockRejectedValueOnce(new Error('denied'));
    await expect(service.getArtifactSet(principal, 'set')).rejects.toThrow('denied');
    expect(repository.findCodeReviewDiagnostics).not.toHaveBeenCalled();
    authorization.resolveProjectContext
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(service.getArtifactSet(principal, 'set')).rejects.toThrow('revoked');
  });
});
