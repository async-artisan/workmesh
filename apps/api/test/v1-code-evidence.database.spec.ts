import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { assertCodeEvidenceAcceptable } from '../src/reviews/v1-review-code-evidence';

/**
 * 验收闸门在真实 PostgreSQL 上的证据绑定链路。
 *
 * 这里覆盖的是原实现的真实缺陷：`prepare` 在工件集下建的是 PENDING 占位票据行，
 * 而 webhook 写入的人类批准证据 `artifactSetId` 为空——按 artifactSetId 取证据只会取到占位行，
 * 导致含 GIT_REF 的交付永远无法验收。既有 DB 套件只测 prepare/consume 原语，测不到这一段。
 */
const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;

const REPO_ID = '123456789';
const CHANGE_ID = '42';
const SHA = 'c'.repeat(40);

suite('code review evidence binding on real PostgreSQL', () => {
  let db: PrismaClient;
  let projectId: string;
  let userId: string;
  let artifactSetId: string;
  let taskId: string;
  let approvedEvidenceId: string;

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);

    const user = await db.user.create({
      data: { email: `${randomUUID()}@evidence.test`, passwordHash: 'fixture' },
    });
    userId = user.id;
    const project = await db.project.create({
      data: {
        key: randomUUID().replaceAll('-', '').slice(0, 6),
        name: 'Evidence binding fixture',
        createdById: userId,
      },
    });
    projectId = project.id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });

    const role = await db.projectRole.create({
      data: { projectId, key: `backend-${randomUUID().slice(0, 8)}`, title: 'Backend' },
    });
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'EVD-001', title: 'Evidence binding' },
    });
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: `standard-${randomUUID().slice(0, 8)}` },
    });
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest: 'a'.repeat(64),
        definition: {},
        compiledRules: {},
      },
    });
    const instance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: definition.id,
        definitionRevisionId: revision.id,
        requirementId: requirement.id,
      },
    });
    const task = await db.task.create({
      data: {
        projectId,
        workflowInstanceId: instance.id,
        stepKey: 'implement',
        roleId: role.id,
        responsibleUserId: userId,
      },
    });
    taskId = task.id;
    const stamp = await db.principalStamp.create({
      data: { kind: 'HUMAN', userId, projectId, userAuthVersion: 1, scopeSnapshot: [] },
    });
    const set = await db.artifactSet.create({
      data: {
        projectId,
        taskId: task.id,
        taskGeneration: 1,
        snapshotId: randomUUID(),
        manifestDigest: 'b'.repeat(64),
        workflowDefinitionRevisionId: revision.id,
        localRunId: `local-${randomUUID()}`,
        createdByStampId: stamp.id,
      },
    });
    artifactSetId = set.id;
    await db.task.update({ where: { id: taskId }, data: { currentArtifactSetId: set.id } });
    const repository = await db.projectRepository.create({
      data: { projectId, adapter: 'GITHUB', externalId: REPO_ID, owner: 'team', name: 'source' },
    });
    await db.artifact.create({
      data: {
        projectId,
        taskId,
        artifactSetId,
        kind: 'IMPL',
        schemaVersion: '1.0',
        storage: 'GIT_REF',
        mediaType: 'text/plain',
        byteLength: 0,
        sha256: 'a'.repeat(64),
        projectRepositoryId: repository.id,
        commitSha: SHA,
        repoPath: 'src/index.ts',
        checks: [],
        submittedByStampId: stamp.id,
      },
    });
    const receipt = await db.webhookReceipt.create({
      data: {
        projectId,
        source: 'GITHUB',
        deliveryId: randomUUID(),
        eventType: 'pull_request_review',
        signatureValid: true,
        payloadDigest: 'a'.repeat(64),
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });

    // 真实的人类批准证据：与 webhook 写入形态一致，不带 artifactSetId。
    const approved = await db.codeReviewEvidence.create({
      data: {
        projectId,
        repositoryId: REPO_ID,
        changeRequestId: CHANGE_ID,
        headSha: SHA,
        authorExternalId: 'author',
        reviewerExternalId: 'reviewer',
        reviewerKind: 'USER',
        state: 'APPROVED',
        commitSha: SHA,
        reviewExternalId: 'review-1',
        evidenceFingerprint: 'd'.repeat(64),
        receiptId: receipt.id,
      },
    });
    approvedEvidenceId = approved.id;

    // prepare 建出来的占位票据行：带 artifactSetId，但状态是 PENDING。
    await db.codeReviewEvidence.create({
      data: {
        projectId,
        repositoryId: REPO_ID,
        changeRequestId: CHANGE_ID,
        headSha: SHA,
        authorExternalId: '_ticket',
        reviewerExternalId: '_ticket',
        reviewerKind: 'USER',
        state: 'PENDING',
        commitSha: SHA,
        reviewExternalId: `ticket:${randomUUID()}`,
        artifactSetId,
        evidenceFingerprint: 'e'.repeat(64),
        preparedSecretHash: 'f'.repeat(64),
        preparedExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        preparedEvidenceId: approvedEvidenceId,
        ticketGeneration: 1,
      },
    });
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        await db.codeReviewEvidence.deleteMany({ where: { projectId } });
        await db.webhookReceipt.deleteMany({ where: { projectId } });
        await db.artifact.deleteMany({ where: { projectId } });
        await db.projectRepository.deleteMany({ where: { projectId } });
        await db.artifactSet.deleteMany({ where: { projectId } });
        await db.task.deleteMany({ where: { projectId } });
        await db.workflowInstance.deleteMany({ where: { projectId } });
        await db.workflowRevision.deleteMany({ where: { projectId } });
        await db.workflowDefinition.deleteMany({ where: { projectId } });
        await db.requirement.deleteMany({ where: { projectId } });
        await db.projectRole.deleteMany({ where: { projectId } });
        await db.projectMember.deleteMany({ where: { projectId } });
        await db.principalStamp.deleteMany({ where: { projectId } });
        await db.project.delete({ where: { id: projectId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });

  async function setTicketConsumed(consumed: boolean): Promise<void> {
    await db.codeReviewEvidence.updateMany({
      where: { artifactSetId, preparedSecretHash: { not: null } },
      data: { preparedExpiresAt: consumed ? null : new Date(Date.now() + 15 * 60 * 1000) },
    });
  }

  async function setApprovedState(state: 'APPROVED' | 'CHANGES_REQUESTED'): Promise<void> {
    await db.codeReviewEvidence.update({ where: { id: approvedEvidenceId }, data: { state } });
  }

  it('rejects while the prepared ticket is still unconsumed', async () => {
    await setTicketConsumed(false);
    await setApprovedState('APPROVED');
    await expect(
      assertCodeEvidenceAcceptable({ tx: db, projectId, artifactSetId, taskId }),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
        references: [{ status: 'TICKET_LIVE' }],
      },
    });
  });

  it('accepts once the ticket is consumed and resolves the human approval', async () => {
    await setTicketConsumed(true);
    await setApprovedState('APPROVED');
    // 占位行本身是 PENDING；能通过说明解析到的是真实批准证据，而不是占位行。
    await expect(
      assertCodeEvidenceAcceptable({ tx: db, projectId, artifactSetId, taskId }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the bound evidence is no longer approved', async () => {
    await setTicketConsumed(true);
    await setApprovedState('CHANGES_REQUESTED');
    await expect(
      assertCodeEvidenceAcceptable({ tx: db, projectId, artifactSetId, taskId }),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        reason: 'CODE_EVIDENCE_CHAIN_INCOMPLETE',
        references: [{ status: 'REVIEW_NOT_QUALIFYING' }],
      },
    });
  });

  it('rejects once the ticket is released again (stale binding)', async () => {
    await setTicketConsumed(false);
    await setApprovedState('APPROVED');
    await expect(
      assertCodeEvidenceAcceptable({ tx: db, projectId, artifactSetId, taskId }),
    ).rejects.toMatchObject({ details: { references: [{ status: 'TICKET_LIVE' }] } });
  });

  it('documents why the legacy artifactSet-only query could never pass', async () => {
    await setTicketConsumed(true);
    await setApprovedState('APPROVED');
    // 旧实现直接按 artifactSetId 取证据。数据里这一口径只会命中 PENDING 占位票据行，
    // 真实批准证据不带 artifactSetId —— 于是判定恒不通过。这条用例把该结论钉在 CI 上：
    // 若将来有人把闸门改回按 artifactSetId 直接取，上面的用例会回落，而这里仍能解释原因。
    const legacy = await db.codeReviewEvidence.findMany({
      where: { projectId, artifactSetId },
      select: { state: true, reviewerKind: true },
    });
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ state: 'PENDING' });
    expect(legacy.every((row) => row.state === 'APPROVED')).toBe(false);

    // 而真实批准证据确实不带 artifactSetId：正因如此才必须沿票据解析。
    const approved = await db.codeReviewEvidence.findUniqueOrThrow({
      where: { id: approvedEvidenceId },
      select: { artifactSetId: true, state: true },
    });
    expect(approved).toMatchObject({ artifactSetId: null, state: 'APPROVED' });
  });
});
