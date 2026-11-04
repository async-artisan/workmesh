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
        return where && 'id' in where ? (input.evidence ?? []) : (input.tickets ?? []);
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
        { preparedSecretHash: 'h', preparedExpiresAt: new Date(), preparedEvidenceId: 'ev-1' },
      ],
      evidence: [{ state: 'APPROVED', reviewerKind: 'USER' }],
    });
    expect(error.details).toMatchObject({
      reason: 'CODE_CLAIM_REQUIRES_APPROVED_PR_REVIEW',
      boundEvidenceCount: 0,
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
      reason: 'BOUND_EVIDENCE_NOT_APPROVED',
      boundEvidenceCount: 1,
    });
  });

  it('rejects when the bound evidence comes from a bot', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'GIT_REF', commitSha: 'a'.repeat(40) }],
      tickets: [CONSUMED],
      evidence: [{ state: 'APPROVED', reviewerKind: 'BOT' }],
    });
    expect(error.details).toMatchObject({
      reason: 'BOUND_EVIDENCE_NOT_APPROVED',
      acceptedEvidenceCount: 0,
    });
  });

  it('rejects a code delivery that never prepared a ticket', async () => {
    const error = await rejectionOf({
      artifacts: [{ storage: 'HOSTED', commitSha: 'b'.repeat(40) }],
      tickets: [],
      evidence: [],
    });
    // 带 commitSha 的托管工件同样声称包含代码。
    expect(error.details).toMatchObject({ reason: 'CODE_CLAIM_REQUIRES_APPROVED_PR_REVIEW' });
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
      id: { in: ['ev-1'] },
      preparedSecretHash: null,
    });
  });
});
