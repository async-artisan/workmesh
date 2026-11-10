import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildRequirementTrustChain,
  type TrustData,
  type TrustReview,
} from './requirement-trust-chain';

const at = new Date('2026-11-10T01:00:00Z');
const human = { kind: 'HUMAN', user: { id: 'signer', email: 'owner@example.test' } };
function approved(
  id: string,
  subjectDigest: string,
  overrides: Partial<TrustReview> = {},
): TrustReview {
  return {
    id,
    kind: 'TASK_ACCEPTANCE',
    taskId: null,
    taskGeneration: null,
    artifactSetId: null,
    documentRevisionId: null,
    status: 'APPROVED',
    subjectDigest,
    createdAt: at,
    approvalSlots: [{ id: `${id}-slot` }],
    decisions: [
      {
        id: `${id}-decision`,
        approvalSlotId: `${id}-slot`,
        decision: 'APPROVE',
        subjectDigest,
        createdAt: at,
        createdByStamp: human,
        revocation: null,
      },
    ],
    ...overrides,
  };
}
function fixture(): TrustData {
  const documents = ['UNDERSTANDING', 'PRD'].map((kind) => ({
    id: `doc-${kind}`,
    knowledgeBaseId: 'kb',
    kind,
    archivedAt: null,
    currentPublishedRevisionId: `rev-${kind}`,
    revisions: [
      {
        id: `rev-${kind}`,
        seq: 1,
        title: kind,
        sha256: `digest-${kind}`,
        basisUnderstandingRevisionId: kind === 'PRD' ? 'rev-UNDERSTANDING' : null,
        acceptance: kind === 'PRD' ? [{ key: 'A1' }] : [],
        publications: [
          {
            id: `pub-${kind}`,
            kind: 'PUBLISH',
            revisionId: `rev-${kind}`,
            reviewRequestId: `review-${kind}`,
            createdAt: at,
          },
        ],
      },
    ],
  }));
  return {
    requirement: {
      id: 'req',
      generation: 3,
      currentUnderstandingRevisionId: 'rev-UNDERSTANDING',
      currentPrdRevisionId: 'rev-PRD',
    },
    documents,
    tasks: [
      {
        id: 'task',
        stepKey: 'build',
        generation: 4,
        acceptanceKeys: ['A1'],
        executionStatus: 'DONE',
        workStatus: 'ACTIVE',
        currentSnapshotId: 'snapshot',
        currentArtifactSetId: 'set',
        instance: {
          id: 'instance',
          definitionRevisionId: 'workflow',
          workStatus: 'ACTIVE',
          retiredAt: null,
        },
      },
    ],
    sets: [
      {
        id: 'set',
        taskId: 'task',
        taskGeneration: 4,
        snapshotId: 'snapshot',
        workflowDefinitionRevisionId: 'workflow',
        manifestDigest: 'set-digest',
        createdAt: at,
        createdByStamp: { kind: 'AGENT', user: { id: 'agent-user', email: 'agent@example.test' } },
        artifacts: [{ storage: 'HOSTED', commitSha: null, projectRepositoryId: null }],
      },
    ],
    snapshots: [
      {
        id: 'snapshot',
        taskId: 'task',
        taskGeneration: 4,
        requirementId: 'req',
        requirementGeneration: 3,
        workflowDefinitionRevisionId: 'workflow',
        manifest: {
          taskId: 'task',
          taskGeneration: 4,
          requirementId: 'req',
          requirementGeneration: 3,
          workflowDefinitionRevisionId: 'workflow',
          baselinePolicy: 'PUBLISHED_PRD',
          productBaseline: {
            understandingRevisionId: 'rev-UNDERSTANDING',
            prdRevisionId: 'rev-PRD',
            prdSha256: 'digest-PRD',
            deliveryScopeDigest: createHash('sha256').update('null').digest('hex'),
          },
          resources: documents.map((document) => ({
            kind: 'DOCUMENT_REVISION',
            targetId: document.revisions[0].id,
            sha256: document.revisions[0].sha256,
            authority: 'PUBLISHED',
          })),
        },
      },
    ],
    reviews: [
      approved('review-UNDERSTANDING', 'digest-UNDERSTANDING', {
        documentRevisionId: 'rev-UNDERSTANDING',
        kind: 'UNDERSTANDING_CONFIRM',
      }),
      approved('review-PRD', 'digest-PRD', {
        documentRevisionId: 'rev-PRD',
        kind: 'PRD_PUBLICATION',
      }),
      approved('acceptance', 'set-digest', {
        taskId: 'task',
        taskGeneration: 4,
        artifactSetId: 'set',
      }),
    ],
    definitions: [
      {
        id: 'workflow',
        definition: {
          steps: [{ key: 'build', displayName: '实现功能', baselinePolicy: 'PUBLISHED_PRD' }],
        },
      },
    ],
    evidence: [],
    repositories: [],
    changes: [],
  };
}
const read = (data: TrustData) =>
  buildRequirementTrustChain(data, new Set(data.documents.map((doc) => doc.id)), at);

describe('requirement formal fact chain', () => {
  it('links only current delivery/snapshot/generation and all signed slots, keeping Agent submission distinct', () => {
    const result = read(fixture());
    expect(result).toMatchObject({
      scope: 'FORMAL_FACT_CHAIN',
      status: 'LINKED',
      gaps: [],
      acceptance: [{ key: 'A1', taskIds: ['task'], acceptedTaskIds: ['task'] }],
    });
    expect(result.timeline.find((event) => event.kind === 'DELIVERY')).toMatchObject({
      source: 'AGENT_SUBMITTED',
      taskGeneration: 4,
      requirementGeneration: 3,
    });
    expect(
      result.timeline.find((event) => event.id === 'decision:acceptance-decision'),
    ).toMatchObject({ source: 'HUMAN_SIGNED', applicability: 'CURRENT' });
  });
  it('keeps old approved evidence historical after rework and does not choose latest review as current', () => {
    const data = fixture();
    data.tasks[0].generation = 5;
    data.tasks[0].executionStatus = 'OPEN';
    data.tasks[0].currentArtifactSetId = null;
    const result = read(data);
    expect(result.status).toBe('GAPS');
    expect(result.tasks[0]).toMatchObject({
      state: 'PENDING',
      gapCodes: ['DELIVERY_MISSING', 'TASK_NOT_ACCEPTED'],
    });
    expect(
      result.timeline.find((event) => event.id === 'decision:acceptance-decision')?.applicability,
    ).toBe('HISTORICAL');
  });
  it('matches release tasks to release acceptance instead of ordinary task acceptance', () => {
    const data = fixture();
    data.definitions[0].definition = {
      steps: [{ key: 'build', kind: 'RELEASE', baselinePolicy: 'PUBLISHED_PRD' }],
    };
    expect(read(data).tasks[0].gapCodes).toContain('APPROVAL_MISSING');
    data.reviews[2].kind = 'RELEASE_ACCEPTANCE';
    expect(read(data).tasks[0]).toMatchObject({ state: 'ACCEPTED', baselineRelation: 'CURRENT' });
  });
  it('checks current snapshot baseline revision and resource digests instead of trusting generation alone', () => {
    const data = fixture();
    const manifest = data.snapshots[0].manifest as {
      productBaseline: { prdRevisionId: string; prdSha256: string };
      resources: Array<{ sha256: string }>;
    };
    manifest.productBaseline.prdRevisionId = 'wrong-prd';
    expect(read(data).tasks[0]).toMatchObject({ state: 'STALE', baselineRelation: 'STALE' });
    manifest.productBaseline.prdRevisionId = 'rev-PRD';
    manifest.productBaseline.prdSha256 = 'wrong-digest';
    expect(read(data).tasks[0].gapCodes).toContain('SNAPSHOT_STALE');
    manifest.productBaseline.prdSha256 = 'digest-PRD';
    manifest.resources[0].sha256 = 'wrong-understanding-digest';
    expect(read(data).tasks[0].gapCodes).toContain('SNAPSHOT_STALE');
    const unavailable = buildRequirementTrustChain(data, new Set(['doc-UNDERSTANDING']), at);
    expect(unavailable.tasks[0]).toMatchObject({ state: 'PENDING', baselineRelation: 'UNKNOWN' });
    expect(unavailable.tasks[0].gapCodes).toContain('SNAPSHOT_UNVERIFIABLE');
  });
  it('shows withdrawal and revocation as durable facts without inventing a withdrawal signer', () => {
    const data = fixture();
    data.requirement.currentPrdRevisionId = null;
    data.documents[1].currentPublishedRevisionId = null;
    data.documents[1].revisions[0].publications.push({
      id: 'withdraw',
      kind: 'WITHDRAW',
      revisionId: 'rev-PRD',
      reviewRequestId: null,
      createdAt: new Date(at.getTime() + 1000),
    });
    data.reviews[1].decisions[0].revocation = {
      id: 'revocation',
      createdAt: new Date(at.getTime() + 1000),
      createdByStamp: human,
    };
    const result = read(data);
    expect(result.gaps).toContainEqual({ code: 'BASELINE_MISSING', baselineKind: 'PRD' });
    expect(result.timeline.find((event) => event.kind === 'WITHDRAWAL')).toMatchObject({
      source: 'PLATFORM_FACT',
      applicability: 'WITHDRAWN',
      actors: [],
    });
    expect(result.timeline.find((event) => event.kind === 'REVOCATION')).toMatchObject({
      source: 'HUMAN_SIGNED',
      applicability: 'REVOKED',
    });
    expect(
      result.timeline.find((event) => event.id === 'decision:review-PRD-decision')?.applicability,
    ).toBe('REVOKED');
  });
  it('requires each approval slot, unrevoked signatures and matching subject digests', () => {
    const data = fixture();
    data.reviews[2].approvalSlots.push({ id: 'missing' });
    expect(read(data).tasks[0].gapCodes).toContain('APPROVAL_MISSING');
    data.reviews[2].approvalSlots.pop();
    data.reviews[2].decisions[0].createdByStamp = null;
    expect(read(data).tasks[0].gapCodes).toContain('SIGNATURE_UNRECORDED');
    data.reviews[2].decisions[0].createdByStamp = { kind: 'HUMAN', user: null };
    expect(read(data).tasks[0].gapCodes).toContain('SIGNATURE_UNRECORDED');
    expect(
      read(data).timeline.find((event) => event.id === 'decision:acceptance-decision')?.source,
    ).toBe('UNRECORDED_ACTOR');
    data.reviews[2].decisions[0].subjectDigest = 'old';
    expect(read(data).tasks[0].gapCodes).toContain('APPROVAL_MISSING');
  });
  it('distinguishes current snapshots from preserved acceptance across requirement generations', () => {
    const data = fixture();
    data.snapshots[0].requirementGeneration = 2;
    (data.snapshots[0].manifest as { requirementGeneration: number }).requirementGeneration = 2;
    expect(read(data).tasks[0]).toMatchObject({
      state: 'ACCEPTED',
      baselineRelation: 'PRESERVED_ACCEPTANCE',
    });
    data.snapshots[0].requirementGeneration = 9;
    expect(read(data).tasks[0]).toMatchObject({ state: 'STALE', baselineRelation: 'STALE' });
    data.snapshots[0].requirementGeneration = 2;
    data.tasks[0].executionStatus = 'REVIEW_PENDING';
    expect(read(data).tasks[0]).toMatchObject({ state: 'STALE', baselineRelation: 'STALE' });
  });
  it('accepts a NONE-policy snapshot without inventing a required PRD input', () => {
    const data = fixture();
    data.definitions[0].definition = { steps: [{ key: 'build', baselinePolicy: 'NONE' }] };
    const manifest = data.snapshots[0].manifest as {
      baselinePolicy: string;
      productBaseline: unknown;
      resources: unknown[];
    };
    manifest.baselinePolicy = 'NONE';
    manifest.productBaseline = null;
    manifest.resources = [];
    expect(read(data).tasks[0]).toMatchObject({ state: 'ACCEPTED', baselineRelation: 'CURRENT' });
  });
  it('reports unassigned acceptance and excludes retired workflows from current completeness', () => {
    const data = fixture();
    data.tasks[0].instance.retiredAt = at;
    expect(read(data)).toMatchObject({
      status: 'GAPS',
      tasks: [{ state: 'RETIRED' }],
      acceptance: [{ taskIds: [], acceptedTaskIds: [] }],
    });
    expect(read(data).gaps).toEqual(
      expect.arrayContaining([
        { code: 'WORKFLOW_MISSING' },
        { code: 'ACCEPTANCE_UNASSIGNED', acceptanceKey: 'A1' },
      ]),
    );
  });
  it('does not claim code is linked without consumed current-generation tickets and signed webhook evidence for the exact commit', () => {
    const data = fixture();
    data.sets[0].artifacts[0] = {
      storage: 'GIT_REF',
      commitSha: 'a'.repeat(40),
      projectRepositoryId: 'repo',
    };
    expect(read(data).tasks[0].gapCodes).toContain('CODE_EVIDENCE_MISSING');
    data.repositories = [{ id: 'repo', externalId: 'github:1', archivedAt: null }];
    const base = {
      artifactSetId: null,
      preparedSecretHash: null,
      preparedExpiresAt: null,
      preparedEvidenceId: null,
      ticketGeneration: null,
      state: 'APPROVED',
      reviewerKind: 'HUMAN',
      repositoryId: 'github:1',
      headSha: 'a'.repeat(40),
      commitSha: 'a'.repeat(40),
      receipt: { signatureValid: true, status: 'PROCESSED' },
    };
    data.evidence = [
      {
        ...base,
        id: 'ticket',
        artifactSetId: 'set',
        preparedSecretHash: 'not-exposed',
        preparedEvidenceId: 'evidence',
        ticketGeneration: 4,
      },
      { ...base, id: 'evidence' },
    ];
    expect(read(data).status).toBe('LINKED');
    data.evidence[1].headSha = 'b'.repeat(40);
    data.evidence[1].commitSha = null;
    expect(read(data).tasks[0].gapCodes).toContain('CODE_EVIDENCE_INVALID');
    data.evidence[0].ticketGeneration = 3;
    expect(read(data).tasks[0].gapCodes).toContain('CODE_EVIDENCE_MISSING');
  });
  it('suppresses unreadable baseline IDs, titles and their reviews and never treats partial visibility as complete', () => {
    const data = fixture();
    const result = buildRequirementTrustChain(data, new Set(['doc-UNDERSTANDING']), at);
    expect(result).toMatchObject({ visibility: 'PARTIAL', status: 'UNAVAILABLE' });
    expect(result.baselines[1]).toEqual({ kind: 'PRD', state: 'UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('rev-PRD');
    expect(JSON.stringify(result)).not.toContain('review-PRD');
  });
});
