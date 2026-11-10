import { describe, expect, it } from 'vitest';
import { WorkmeshError } from '@workmesh/shared';
import {
  assertCodeEvidenceAcceptable,
  boundEvidenceIds,
  type CodeEvidenceGateTx,
} from './v1-review-code-evidence';

const CONSUMED = {
  preparedSecretHash: 'secret-hash',
  preparedExpiresAt: null,
  preparedEvidenceId: 'ev-1',
};

type FakeInput = {
  artifacts: { storage: string; commitSha: string | null }[];
  tickets?: Record<string, unknown>[];
  evidence?: Record<string, unknown>[];
};

function fakeTx(input: FakeInput): {
  tx: CodeEvidenceGateTx;
  queries: { model: string; args: unknown }[];
} {
  const queries: { model: string; args: unknown }[] = [];
  const tx = {
    artifactSet: {
      findFirst: async () => ({
        taskGeneration: 1,
        artifacts: input.artifacts.map((row, index) => ({
          ...row,
          id: `artifact-${index}`,
          projectRepositoryId: 'registered-repo',
        })),
        task: {
          generation: 1,
          currentArtifactSetId: 'set-1',
          workStatus: 'ACTIVE',
          instance: { retiredAt: null },
        },
      }),
    },
    projectRepository: {
      findMany: async () => [
        {
          id: 'registered-repo',
          owner: 'owner',
          name: 'repo',
          externalId: 'repo-1',
          identityMode: 'PROVIDER',
          adapter: 'GITHUB',
          archivedAt: null,
        },
      ],
    },
    webhookReceipt: {
      findMany: async () => [
        {
          id: 'receipt',
          signatureValid: true,
          eventType: 'pull_request',
          status: 'PROCESSED',
          receivedAt: new Date(),
          processedAt: new Date(),
        },
      ],
    },
    artifact: {
      findMany: async (args: unknown) => {
        queries.push({ model: 'artifact', args });
        return input.artifacts;
      },
    },
    codeReviewEvidence: {
      findMany: async (args: unknown) => {
        queries.push({ model: 'codeReviewEvidence', args });
        const where = (args as { where?: Record<string, unknown> }).where;
        // 第二次查询按 id 取证据本体；第一次取票据行。
        return where && 'artifactSetId' in where
          ? (input.tickets ?? []).map((row) => ({
              id: 'ticket',
              repositoryId: 'repo-1',
              changeRequestId: 'PR-1',
              headSha: 'a'.repeat(40),
              ticketGeneration: 1,
              ...row,
            }))
          : (input.evidence ?? []).map((row) => ({
              id: 'ev-1',
              repositoryId: 'repo-1',
              changeRequestId: 'PR-1',
              headSha: 'a'.repeat(40),
              commitSha: 'a'.repeat(40),
              reviewerExternalId: 'reviewer',
              authorExternalId: 'author',
              submittedAt: new Date(),
              createdAt: new Date(),
              receiptId: 'receipt',
              ...row,
            }));
      },
    },
  };
  return { tx: tx as unknown as CodeEvidenceGateTx, queries };
}

const BASE = { projectId: 'p1', artifactSetId: 'set-1', taskId: 'task-1' };

async function rejectionOf(input: FakeInput): Promise<WorkmeshError> {
  const { tx } = fakeTx(input);
  const caught = await assertCodeEvidenceAcceptable({ ...BASE, tx }).catch(
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(WorkmeshError);
  return caught as WorkmeshError;
}

describe('boundEvidenceIds', () => {
  it('takes only the evidence referenced by a consumed ticket', () => {
    expect(
      boundEvidenceIds([
        CONSUMED,
        {
          preparedSecretHash: 'h',
          preparedExpiresAt: new Date(),
          preparedEvidenceId: 'not-consumed',
        },
        { preparedSecretHash: null, preparedExpiresAt: null, preparedEvidenceId: 'real-row' },
        { preparedSecretHash: 'h', preparedExpiresAt: null, preparedEvidenceId: null },
      ]),
    ).toEqual(['ev-1']);
  });

  it('deduplicates repeated bindings', () => {
    expect(boundEvidenceIds([CONSUMED, { ...CONSUMED }])).toEqual(['ev-1']);
  });
});

describe('code evidence acceptance gate', () => {
  it('does not require evidence for hosted-only deliverables', async () => {
    const { tx, queries } = fakeTx({ artifacts: [{ storage: 'HOSTED', commitSha: null }] });
    await expect(assertCodeEvidenceAcceptable({ ...BASE, tx })).resolves.toBeUndefined();
    // 纯托管交付不应触发任何证据查询。
    expect(queries.filter((query) => query.model === 'codeReviewEvidence')).toHaveLength(0);
  });

  it('accepts a GIT_REF delivery whose consumed ticket resolves to an approved human review', async () => {
    const { tx } = fakeTx({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [CONSUMED],
      evidence: [{ state: 'APPROVED', reviewerKind: 'USER' }],
    });
    await expect(assertCodeEvidenceAcceptable({ ...BASE, tx })).resolves.toBeUndefined();
  });

  it('rejects when the ticket was prepared but never consumed', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [
        {
          preparedSecretHash: 'h',
          preparedExpiresAt: new Date(Date.now() + 60_000),
          preparedEvidenceId: 'ev-1',
        },
      ],
      evidence: [{ state: 'APPROVED', reviewerKind: 'USER' }],
    });
    expect(error.details).toMatchObject({
      reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
      references: [{ status: 'TICKET_LIVE' }],
    });
    expect(error.status).toBe(422);
  });

  it('rejects when the bound evidence is not approved', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [CONSUMED],
      evidence: [{ state: 'CHANGES_REQUESTED', reviewerKind: 'USER' }],
    });
    expect(error.details).toMatchObject({
      reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
      references: [{ status: 'REVIEW_NOT_QUALIFYING' }],
    });
  });

  it('rejects when the bound evidence comes from a bot', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [CONSUMED],
      evidence: [{ state: 'APPROVED', reviewerKind: 'BOT' }],
    });
    expect(error.details).toMatchObject({
      reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
      references: [{ status: 'REVIEW_NOT_QUALIFYING' }],
    });
  });

  it('rejects a code delivery that never prepared a ticket', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'HOSTED', commitSha: 'b'.repeat(40) }],
      tickets: [],
      evidence: [],
    });
    // 带 commitSha 的托管工件同样声称包含代码。
    expect(error.details).toMatchObject({ reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE' });
  });

  it('excludes placeholder rows from the evidence body query', async () => {
    const { tx, queries } = fakeTx({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [CONSUMED],
      evidence: [{ state: 'APPROVED', reviewerKind: 'USER' }],
    });
    await assertCodeEvidenceAcceptable({ ...BASE, tx });
    const evidenceQuery = queries.filter((query) => query.model === 'codeReviewEvidence')[1];
    expect((evidenceQuery.args as { where: Record<string, unknown> }).where).toMatchObject({
      projectId: 'p1',
      preparedSecretHash: null,
    });
  });
});
