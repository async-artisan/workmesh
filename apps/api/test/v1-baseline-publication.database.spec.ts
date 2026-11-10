import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { V1ReviewPrismaRepository } from '../src/reviews/v1-review.prisma-repository';
import type { V1CommitDecisionInput } from '../src/reviews/v1-review.repository';
import { V1SnapshotPrismaRepository } from '../src/tasks/v1-snapshot.prisma-repository';
import { V1SnapshotService } from '../src/tasks/v1-snapshot.service';
import { V1TaskPrismaRepository } from '../src/tasks/v1-task.prisma-repository';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { RequirementsService } from '../src/projects/requirements.service';
import { canonicalJson, type Principal } from '@workmesh/shared';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
const digest = 'a'.repeat(64);

suite('PostgreSQL baseline publication invalidation', () => {
  let db: PrismaClient;
  let reviews: V1ReviewPrismaRepository;
  const projectIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);
    reviews = new V1ReviewPrismaRepository(db as PrismaService);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      const where = { projectId: { in: projectIds } };
      await db.changeRecipient.deleteMany({ where });
      await db.changeEvent.deleteMany({ where });
      await db.idempotentOperation.deleteMany({ where });
      await db.auditEvent.deleteMany({ where });
      await db.documentPublication.deleteMany({ where });
      await db.reviewDecisionRevocation.deleteMany({ where });
      await db.reviewDecision.deleteMany({ where });
      await db.confirmationTicket.deleteMany({ where });
      await db.approvalSlot.deleteMany({ where });
      await db.reviewRequest.deleteMany({ where });
      await db.artifactSetItem.deleteMany({ where });
      await db.artifact.deleteMany({ where });
      await db.artifactSet.deleteMany({ where });
      await db.snapshotResourceRef.deleteMany({ where });
      await db.contextSnapshot.deleteMany({ where });
      await db.taskClaim.deleteMany({ where });
      await db.task.deleteMany({ where });
      await db.workflowInstance.deleteMany({ where });
      await db.workflowRevision.deleteMany({ where });
      await db.workflowDefinition.deleteMany({ where });
      await db.requirement.updateMany({
        where,
        data: { currentPrdRevisionId: null, currentUnderstandingRevisionId: null },
      });
      await db.documentRevision.deleteMany({ where });
      await db.knowledgeDocument.deleteMany({ where });
      await db.knowledgeBase.deleteMany({ where });
      await db.requirement.deleteMany({ where });
      await db.principalStamp.deleteMany({ where });
      await db.projectRoleAssignment.deleteMany({ where });
      await db.projectRole.deleteMany({ where });
      await db.projectMember.deleteMany({ where });
      await db.project.deleteMany({ where: { id: { in: projectIds } } });
      await db.webSession.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.$disconnect();
    }
  });

  async function fixture({ qaDeps = ['product'] }: { qaDeps?: string[] } = {}) {
    const user = await db.user.create({
      data: { email: `${randomUUID()}@baseline.test`, passwordHash: 'fixture' },
    });
    userIds.push(user.id);
    const project = await db.project.create({
      data: { key: randomUUID().slice(0, 6), name: 'Baseline publication', createdById: user.id },
    });
    projectIds.push(project.id);
    const projectId = project.id;
    const userId = user.id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    const session = await db.webSession.create({
      data: {
        userId,
        tokenHash: randomUUID(),
        csrfTokenHash: randomUUID(),
        userAuthVersion: 1,
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const roles = await Promise.all(
      ['product', 'impl', 'qa', 'release'].map((key) =>
        db.projectRole.create({ data: { projectId, key, title: key } }),
      ),
    );
    const roleIds = Object.fromEntries(roles.map((role) => [role.key, role.id]));
    const requirement = await db.requirement.create({
      data: {
        projectId,
        seq: 1,
        code: 'BASE-1',
        title: 'Baseline fixture',
        generation: 4,
        phase: 'RELEASED',
      },
    });
    const knowledgeBase = await db.knowledgeBase.create({
      data: {
        projectId,
        key: 'product',
        name: 'Product',
        visibility: 'PROJECT',
        publicationApproverUserId: userId,
      },
    });
    const stamp = await db.principalStamp.create({
      data: {
        kind: 'HUMAN',
        projectId,
        userId,
        webSessionId: session.id,
        scopeSnapshot: [],
        userAuthVersion: 1,
      },
    });
    const understandingDocument = await db.knowledgeDocument.create({
      data: {
        projectId,
        knowledgeBaseId: knowledgeBase.id,
        requirementId: requirement.id,
        kind: 'UNDERSTANDING',
      },
    });
    const understanding = await db.documentRevision.create({
      data: {
        projectId,
        documentId: understandingDocument.id,
        seq: 1,
        title: 'Understanding 1',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('understanding'),
        byteLength: 13,
        sha256: digest,
        createdById: userId,
      },
    });
    const prdDocument = await db.knowledgeDocument.create({
      data: {
        projectId,
        knowledgeBaseId: knowledgeBase.id,
        requirementId: requirement.id,
        kind: 'PRD',
      },
    });
    const prd = await db.documentRevision.create({
      data: {
        projectId,
        documentId: prdDocument.id,
        seq: 1,
        title: 'PRD 1',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('prd'),
        byteLength: 3,
        sha256: digest,
        createdById: userId,
        basisUnderstandingRevisionId: understanding.id,
        deliveryScope: { participatingRoleIds: [roleIds.qa] },
      },
    });
    await db.knowledgeDocument.update({
      where: { id: understandingDocument.id },
      data: { currentPublishedRevisionId: understanding.id },
    });
    await db.knowledgeDocument.update({
      where: { id: prdDocument.id },
      data: { currentPublishedRevisionId: prd.id },
    });
    await db.requirement.update({
      where: { id: requirement.id },
      data: {
        currentUnderstandingRevisionId: understanding.id,
        currentPrdRevisionId: prd.id,
        deliveryScope: { participatingRoleIds: [roleIds.qa] },
      },
    });
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: 'baseline' },
    });
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest,
        definition: {
          steps: [
            {
              key: 'product',
              kind: 'PRODUCT',
              baselinePolicy: 'NONE',
              deps: [],
              outputKinds: ['PRD'],
            },
            {
              key: 'impl',
              kind: 'DELIVERY',
              baselinePolicy: 'PUBLISHED_PRD',
              deps: ['product'],
              outputKinds: ['IMPL'],
            },
            {
              key: 'qa',
              kind: 'VERIFY',
              baselinePolicy: 'PUBLISHED_PRD',
              deps: qaDeps,
              outputKinds: ['CASES'],
            },
            {
              key: 'release',
              kind: 'RELEASE',
              baselinePolicy: 'NONE',
              deps: ['impl', 'qa'],
              outputKinds: ['RELEASE'],
            },
            {
              key: 'required-input',
              kind: 'PRODUCT',
              baselinePolicy: 'NONE',
              deps: ['product'],
              outputKinds: ['DESIGN'],
            },
            {
              key: 'unrelated',
              kind: 'PRODUCT',
              baselinePolicy: 'NONE',
              deps: [],
              outputKinds: [],
            },
          ],
        },
        compiledRules: {
          inputSources: [
            {
              stepKey: 'required-input',
              source: 'UPSTREAM_ARTIFACT',
              inputKey: 'prd',
              fromStepKey: 'product',
              reference: 'PRD',
              required: true,
            },
          ],
        },
      },
    });
    const instance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: definition.id,
        definitionRevisionId: revision.id,
        definitionDigest: digest,
        requirementId: requirement.id,
      },
    });
    return {
      projectId,
      userId,
      sessionId: session.id,
      roleIds,
      requirementId: requirement.id,
      knowledgeBaseId: knowledgeBase.id,
      understanding,
      understandingDocument,
      prd,
      prdDocument,
      definition,
      revision,
      instance,
      stamp,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function task(
    f: Fixture,
    stepKey: string,
    roleKey = stepKey,
    current = false,
    instanceId = f.instance.id,
  ) {
    const row = await db.task.create({
      data: {
        projectId: f.projectId,
        workflowInstanceId: instanceId,
        stepKey,
        roleId: f.roleIds[roleKey],
        responsibleUserId: f.userId,
      },
    });
    if (!current) return row;
    const claim = await db.taskClaim.create({
      data: { projectId: f.projectId, taskId: row.id, taskGeneration: 1, userId: f.userId },
    });
    const snapshot = await db.contextSnapshot.create({
      data: {
        projectId: f.projectId,
        requirementId: f.requirementId,
        taskId: row.id,
        requirementGeneration: 4,
        taskGeneration: 1,
        workflowDefinitionRevisionId: f.revision.id,
        claimId: claim.id,
        manifest: {
          productBaseline: { understandingRevisionId: f.understanding.id, prdRevisionId: f.prd.id },
          resources: [],
        },
        manifestDigest: digest,
        createdByStampId: f.stamp.id,
      },
    });
    const set = await db.artifactSet.create({
      data: {
        projectId: f.projectId,
        taskId: row.id,
        taskGeneration: 1,
        snapshotId: snapshot.id,
        manifestDigest: digest,
        workflowDefinitionRevisionId: f.revision.id,
        localRunId: randomUUID(),
        createdByStampId: f.stamp.id,
      },
    });
    return db.task.update({
      where: { id: row.id },
      data: {
        executionStatus: 'REVIEW_PENDING',
        currentClaimId: claim.id,
        currentSnapshotId: snapshot.id,
        currentArtifactSetId: set.id,
      },
    });
  }

  async function decision(
    f: Fixture,
    subject: { taskId?: string; artifactSetId?: string; documentRevisionId?: string },
    kind = 'PRD_PUBLICATION',
  ) {
    const review = await db.reviewRequest.create({
      data: {
        projectId: f.projectId,
        kind,
        ...subject,
        taskGeneration: subject.artifactSetId ? 1 : null,
        subjectDigest: digest,
      },
    });
    const slot = await db.approvalSlot.create({
      data: {
        projectId: f.projectId,
        reviewRequestId: review.id,
        slotKey: 'approval',
        kind,
        requiredUserId: f.userId,
      },
    });
    const secretHash = createHash('sha256').update(randomUUID()).digest('hex');
    const ticket = await db.confirmationTicket.create({
      data: {
        projectId: f.projectId,
        userId: f.userId,
        webSessionId: f.sessionId,
        userAuthVersion: 1,
        secretHash,
        action: 'REVIEW_DECIDE',
        targetType: 'REVIEW_REQUEST',
        targetId: review.id,
        expectedVersion: 1,
        actionDigest: digest,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const input: V1CommitDecisionInput = {
      reviewId: review.id,
      expectedVersion: 1,
      slotId: slot.id,
      decision: 'APPROVE',
      subjectDigest: digest,
      comment: 'Database baseline review',
      actorUserId: f.userId,
      roleSlot: null,
      operationId: randomUUID(),
      ticket: { id: ticket.id, secretHash, webSessionId: f.sessionId },
      principalScopeKey: `user:${f.userId}`,
      projectScopeKey: `project:${f.projectId}`,
      operationKey: randomUUID(),
      method: 'POST',
      route: `/reviews/${review.id}/decisions`,
      requestDigest: digest,
      now: new Date(),
    };
    return { review, input, ticket };
  }

  async function replacement(f: Fixture) {
    return db.documentRevision.create({
      data: {
        projectId: f.projectId,
        documentId: f.prdDocument.id,
        seq: 2,
        title: 'PRD 2',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('prd 2'),
        byteLength: 5,
        sha256: digest,
        createdById: f.userId,
        basisUnderstandingRevisionId: f.understanding.id,
        deliveryScope: { participatingRoleIds: [f.roleIds.qa] },
      },
    });
  }

  it('reopens affected current tasks, preserves approved history and notifies each responsible role once', async () => {
    const f = await fixture();
    const qa = await task(f, 'qa', 'qa', true);
    const accepted = await decision(
      f,
      { taskId: qa.id, artifactSetId: qa.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    await reviews.commitDecision(accepted.input);
    const qaBefore = await db.task.findUniqueOrThrow({ where: { id: qa.id } });
    const impl = await task(f, 'impl', 'impl', true);
    const pending = await decision(
      f,
      { taskId: impl.id, artifactSetId: impl.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    const release = await task(f, 'release', 'release');
    const required = await task(f, 'required-input', 'release');
    const unrelated = await task(f, 'unrelated', 'product');
    const retired = await db.workflowInstance.create({
      data: {
        projectId: f.projectId,
        definitionId: f.definition.id,
        definitionRevisionId: f.revision.id,
        requirementId: f.requirementId,
        retiredAt: new Date(),
      },
    });
    const retiredTask = await task(f, 'qa', 'qa', false, retired.id);
    const otherRequirement = await db.requirement.create({
      data: { projectId: f.projectId, seq: 2, code: 'BASE-2', title: 'Unrelated requirement' },
    });
    const otherInstance = await db.workflowInstance.create({
      data: {
        projectId: f.projectId,
        definitionId: f.definition.id,
        definitionRevisionId: f.revision.id,
        requirementId: otherRequirement.id,
      },
    });
    const otherTask = await task(f, 'qa', 'qa', false, otherInstance.id);
    const foreign = await fixture();
    const foreignTask = await task(foreign, 'qa', 'qa');
    const revision = await replacement(f);
    const publication = await decision(f, { documentRevisionId: revision.id });
    const result = await reviews.commitDecision(publication.input);
    const affected = [qaBefore, impl, release, required];
    for (const before of affected) {
      expect(await db.task.findUnique({ where: { id: before.id } })).toMatchObject({
        version: before.version + 1,
        generation: before.generation + 1,
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
        currentClaimId: null,
        currentSnapshotId: null,
        currentArtifactSetId: null,
      });
    }
    for (const before of [unrelated, retiredTask, otherTask, foreignTask])
      expect(await db.task.findUnique({ where: { id: before.id } })).toEqual(before);
    expect(await db.taskClaim.findUnique({ where: { id: impl.currentClaimId! } })).toMatchObject({
      releasedAt: expect.any(Date),
      releaseReason: `baseline-published:${result.publicationId}`,
    });
    expect(await db.reviewRequest.findUnique({ where: { id: accepted.review.id } })).toMatchObject({
      status: 'APPROVED',
      version: 2,
    });
    expect(
      await db.artifactSet.findUnique({ where: { id: qa.currentArtifactSetId! } }),
    ).toMatchObject({ taskId: qa.id, taskGeneration: 1 });
    expect(
      await db.contextSnapshot.findUnique({ where: { id: qa.currentSnapshotId! } }),
    ).toMatchObject({ taskGeneration: 1, requirementGeneration: 4 });
    expect(await db.reviewRequest.findUnique({ where: { id: pending.review.id } })).toMatchObject({
      status: 'INVALIDATED',
      version: 2,
    });
    await expect(reviews.commitDecision(pending.input)).rejects.toMatchObject({
      message: 'REVIEW_CLOSED',
    });
    expect(
      await db.confirmationTicket.findUnique({ where: { id: pending.ticket.id } }),
    ).toMatchObject({ consumedAt: null });
    expect(await db.requirement.findUnique({ where: { id: f.requirementId } })).toMatchObject({
      generation: 5,
      phase: 'RELEASED',
      currentPrdRevisionId: revision.id,
    });
    const events = await db.changeEvent.findMany({
      where: { projectId: f.projectId },
      include: { recipients: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceKind: 'DOCUMENT_PUBLICATION',
      sourceId: result.publicationId,
      changedFields: ['currentPrdRevisionId', 'generation'],
      targets: {
        taskIds: affected.map((row) => row.id).sort(),
        documentId: f.prdDocument.id,
        previousDocumentRevisionId: f.prd.id,
        documentRevisionId: revision.id,
        requirementGeneration: 5,
      },
    });
    expect(events[0].recipients.map((row) => `${row.userId}:${row.roleId}`).sort()).toEqual(
      [f.roleIds.qa, f.roleIds.impl, f.roleIds.release]
        .map((roleId) => `${f.userId}:${roleId}`)
        .sort(),
    );
    expect(
      events[0].recipients.every((row) => row.action === 'ACK_ONLY' && row.ackedAt === null),
    ).toBe(true);
    await expect(reviews.commitDecision(publication.input)).rejects.toMatchObject({
      message: 'REVIEW_CLOSED',
    });
    expect(await db.changeEvent.count({ where: { sourceId: result.publicationId! } })).toBe(1);
  });

  it('projects actual baseline replacement, historical acceptance, revocation and live KB permission into the requirement trust chain', async () => {
    const f = await fixture();
    const qa = await task(f, 'qa', 'qa', true);
    const acceptance = await decision(
      f,
      { taskId: qa.id, artifactSetId: qa.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    const accepted = await reviews.commitDecision(acceptance.input);
    const manifest = {
      taskId: qa.id,
      taskGeneration: qa.generation,
      requirementId: f.requirementId,
      requirementGeneration: 4,
      workflowDefinitionRevisionId: f.revision.id,
      baselinePolicy: 'PUBLISHED_PRD',
      productBaseline: {
        understandingRevisionId: f.understanding.id,
        prdRevisionId: f.prd.id,
        prdSha256: f.prd.sha256,
        deliveryScopeDigest: createHash('sha256')
          .update(canonicalJson(f.prd.deliveryScope))
          .digest('hex'),
      },
      resources: [f.understanding, f.prd].map((revision) => ({
        kind: 'DOCUMENT_REVISION',
        targetId: revision.id,
        sha256: revision.sha256,
        authority: 'PUBLISHED',
      })),
    };
    await db.contextSnapshot.update({ where: { id: qa.currentSnapshotId! }, data: { manifest } });
    const service = new RequirementsService(
      db as PrismaService,
      new V1AuthorizationService(new V1AuthorizationPrismaRepository(db as PrismaService)),
    );
    const principal = {
      kind: 'HUMAN',
      userId: f.userId,
      sessionId: f.sessionId,
      authVersion: 1,
      scopes: [],
    } as unknown as Principal;
    const before = await service.detail(principal, f.projectId, f.requirementId);
    expect(before.trustChain.tasks.find((item) => item.taskId === qa.id)).toMatchObject({
      state: 'ACCEPTED',
      baselineRelation: 'CURRENT',
    });
    await db.contextSnapshot.update({
      where: { id: qa.currentSnapshotId! },
      data: {
        manifest: {
          ...manifest,
          productBaseline: { ...manifest.productBaseline, prdRevisionId: randomUUID() },
        },
      },
    });
    const inconsistentSnapshot = await service.detail(principal, f.projectId, f.requirementId);
    expect(
      inconsistentSnapshot.trustChain.tasks.find((item) => item.taskId === qa.id),
    ).toMatchObject({
      state: 'STALE',
      baselineRelation: 'STALE',
      gapCodes: expect.arrayContaining(['SNAPSHOT_STALE']),
    });
    await db.contextSnapshot.update({ where: { id: qa.currentSnapshotId! }, data: { manifest } });
    const replacementPrd = await replacement(f);
    const publication = await decision(f, { documentRevisionId: replacementPrd.id });
    const published = await reviews.commitDecision(publication.input);
    const after = await service.detail(principal, f.projectId, f.requirementId);
    expect(after.trustChain.baselines.find((item) => item.kind === 'PRD')).toMatchObject({
      state: 'CURRENT',
      revisionId: replacementPrd.id,
    });
    expect(after.trustChain.tasks.find((item) => item.taskId === qa.id)).toMatchObject({
      state: 'PENDING',
      artifactSetId: null,
    });
    expect(
      after.trustChain.timeline.find((item) => item.id === `decision:${accepted.decisionId}`),
    ).toMatchObject({
      applicability: 'HISTORICAL',
      source: 'HUMAN_SIGNED',
      actors: [{ userId: f.userId }],
    });
    expect(
      after.trustChain.timeline.find(
        (item) => item.id === `publication:${published.publicationId}`,
      ),
    ).toMatchObject({ kind: 'PUBLICATION', applicability: 'CURRENT' });
    expect(after.tasks.find((item) => item.id === qa.id)?.review).toBeNull();

    const secretHash = createHash('sha256').update(randomUUID()).digest('hex');
    const ticket = await db.confirmationTicket.create({
      data: {
        projectId: f.projectId,
        userId: f.userId,
        webSessionId: f.sessionId,
        userAuthVersion: 1,
        secretHash,
        action: 'REVIEW_REVOKE',
        targetType: 'REVIEW_DECISION',
        targetId: published.decisionId,
        expectedVersion: published.review.version,
        actionDigest: digest,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await reviews.revokeDecision({
      ...publication.input,
      decisionId: published.decisionId,
      expectedVersion: published.review.version,
      reason: 'The release baseline needs correction',
      operationId: randomUUID(),
      operationKey: randomUUID(),
      ticket: { id: ticket.id, secretHash, webSessionId: f.sessionId },
    });
    const revoked = await service.detail(principal, f.projectId, f.requirementId);
    expect(revoked.trustChain.baselines.find((item) => item.kind === 'PRD')).toMatchObject({
      state: 'MISSING',
    });
    expect(
      revoked.trustChain.timeline.find((item) => item.id === `decision:${published.decisionId}`)
        ?.applicability,
    ).toBe('REVOKED');
    expect(
      revoked.trustChain.timeline.some(
        (item) => item.kind === 'REVOCATION' && item.reviewId === publication.review.id,
      ),
    ).toBe(true);
    expect(
      revoked.trustChain.timeline.some(
        (item) =>
          item.kind === 'WITHDRAWAL' &&
          item.revisionId === replacementPrd.id &&
          item.actors.length === 0,
      ),
    ).toBe(true);

    await db.knowledgeBase.update({
      where: { id: f.knowledgeBaseId },
      data: { visibility: 'RESTRICTED' },
    });
    const restricted = await service.detail(principal, f.projectId, f.requirementId);
    expect(restricted.trustChain).toMatchObject({ visibility: 'PARTIAL', status: 'UNAVAILABLE' });
    expect(restricted.reviews.every((review) => review.documentRevisionId === null)).toBe(true);
    expect(restricted.acceptanceKeys).toEqual([]);
    expect(JSON.stringify(restricted)).not.toContain(replacementPrd.id);
    expect(JSON.stringify(restricted)).not.toContain(f.understanding.id);
    await db.projectMember.update({
      where: { projectId_userId: { projectId: f.projectId, userId: f.userId } },
      data: { revokedAt: new Date() },
    });
    await expect(service.detail(principal, f.projectId, f.requirementId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not manufacture a change event for the first publication without tasks', async () => {
    const f = await fixture();
    await db.knowledgeDocument.update({
      where: { id: f.prdDocument.id },
      data: { currentPublishedRevisionId: null },
    });
    await db.requirement.update({
      where: { id: f.requirementId },
      data: { currentPrdRevisionId: null },
    });
    const publication = await decision(f, { documentRevisionId: f.prd.id });
    await expect(reviews.commitDecision(publication.input)).resolves.toMatchObject({
      published: true,
    });
    expect(await db.changeEvent.count({ where: { projectId: f.projectId } })).toBe(0);
  });

  it('preserves PAUSED and CANCELLED restrictions while invalidating their baseline', async () => {
    const f = await fixture();
    const paused = await task(f, 'qa', 'qa', true);
    const cancelled = await task(f, 'impl', 'impl', true);
    await db.task.update({ where: { id: paused.id }, data: { workStatus: 'PAUSED' } });
    await db.task.update({ where: { id: cancelled.id }, data: { workStatus: 'CANCELLED' } });
    const revision = await replacement(f);
    await reviews.commitDecision((await decision(f, { documentRevisionId: revision.id })).input);
    for (const [row, workStatus] of [
      [paused, 'PAUSED'],
      [cancelled, 'CANCELLED'],
    ] as const) {
      expect(await db.task.findUnique({ where: { id: row.id } })).toMatchObject({
        executionStatus: 'OPEN',
        workStatus,
        generation: 2,
        currentClaimId: null,
        currentSnapshotId: null,
        currentArtifactSetId: null,
      });
      expect(await db.taskClaim.findUnique({ where: { id: row.currentClaimId! } })).toMatchObject({
        releasedAt: expect.any(Date),
      });
    }
  });

  it('preserves only the verified PRODUCT producer and does not trust an arbitrary task association', async () => {
    const f = await fixture();
    const source = await task(f, 'product', 'product', true);
    const qa = await task(f, 'qa', 'qa');
    const revision = await replacement(f);
    await db.artifactSetItem.create({
      data: {
        projectId: f.projectId,
        artifactSetId: source.currentArtifactSetId!,
        candidateRevisionId: revision.id,
      },
    });
    const acceptance = await decision(
      f,
      { taskId: source.id, artifactSetId: source.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    await reviews.commitDecision(acceptance.input);
    const acceptedSource = await db.task.findUniqueOrThrow({ where: { id: source.id } });
    // A document review may omit taskId; the current immutable output still identifies its source.
    const publication = await decision(f, { documentRevisionId: revision.id });
    await reviews.commitDecision(publication.input);
    expect(await db.task.findUnique({ where: { id: source.id } })).toEqual(acceptedSource);
    expect(
      await db.reviewRequest.findUnique({ where: { id: acceptance.review.id } }),
    ).toMatchObject({ status: 'APPROVED', version: 2 });
    expect(await db.task.findUnique({ where: { id: qa.id } })).toMatchObject({ generation: 2 });
    const events = await db.changeEvent.findMany({ where: { projectId: f.projectId } });
    expect((events[0].targets as { taskIds: string[] }).taskIds).toEqual([qa.id]);

    const other = await fixture();
    const forged = await task(other, 'qa', 'qa', true);
    const otherRevision = await replacement(other);
    await db.artifactSetItem.create({
      data: {
        projectId: other.projectId,
        artifactSetId: forged.currentArtifactSetId!,
        candidateRevisionId: otherRevision.id,
      },
    });
    await reviews.commitDecision(
      (await decision(other, { taskId: forged.id, documentRevisionId: otherRevision.id })).input,
    );
    expect(await db.task.findUnique({ where: { id: forged.id } })).toMatchObject({
      generation: 2,
      currentSnapshotId: null,
    });
  });

  it('invalidates an unaccepted PRODUCT source instead of preserving an impossible old-generation acceptance', async () => {
    const f = await fixture();
    const source = await task(f, 'product', 'product', true);
    const revision = await replacement(f);
    await db.artifactSetItem.create({
      data: {
        projectId: f.projectId,
        artifactSetId: source.currentArtifactSetId!,
        candidateRevisionId: revision.id,
      },
    });
    const acceptance = await decision(
      f,
      { taskId: source.id, artifactSetId: source.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    await reviews.commitDecision((await decision(f, { documentRevisionId: revision.id })).input);
    expect(await db.task.findUnique({ where: { id: source.id } })).toMatchObject({
      generation: 2,
      executionStatus: 'OPEN',
      currentClaimId: null,
      currentSnapshotId: null,
      currentArtifactSetId: null,
    });
    expect(await db.taskClaim.findUnique({ where: { id: source.currentClaimId! } })).toMatchObject({
      releasedAt: expect.any(Date),
    });
    expect(
      await db.reviewRequest.findUnique({ where: { id: acceptance.review.id } }),
    ).toMatchObject({ status: 'INVALIDATED', version: 2 });
    await expect(reviews.commitDecision(acceptance.input)).rejects.toMatchObject({
      message: 'REVIEW_CLOSED',
    });
    const event = await db.changeEvent.findFirstOrThrow({
      where: { projectId: f.projectId },
      include: { recipients: true },
    });
    expect((event.targets as { taskIds: string[] }).taskIds).toEqual([source.id]);
    expect(event.recipients).toMatchObject([
      { userId: f.userId, roleId: f.roleIds.product, action: 'ACK_ONLY' },
    ]);
  });

  it('invalidates an approved PRODUCT whose current candidate is replaced without following historical sets', async () => {
    const f = await fixture();
    const oldProducer = await task(f, 'product', 'product', true);
    await db.contextSnapshot.update({
      where: { id: oldProducer.currentSnapshotId! },
      data: {
        manifest: {
          productBaseline: null,
          resources: [{ kind: 'DOCUMENT_REVISION', authority: 'CANDIDATE', targetId: f.prd.id }],
        },
      },
    });
    await db.artifactSetItem.create({
      data: {
        projectId: f.projectId,
        artifactSetId: oldProducer.currentArtifactSetId!,
        candidateRevisionId: f.prd.id,
      },
    });
    const acceptance = await decision(
      f,
      { taskId: oldProducer.id, artifactSetId: oldProducer.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    await reviews.commitDecision(acceptance.input);
    const acceptedProducer = await db.task.findUniqueOrThrow({ where: { id: oldProducer.id } });
    const successor = await task(f, 'required-input', 'release');
    const otherInstance = await db.workflowInstance.create({
      data: {
        projectId: f.projectId,
        definitionId: f.definition.id,
        definitionRevisionId: f.revision.id,
        requirementId: f.requirementId,
      },
    });
    const historicalOnly = await task(f, 'product', 'product', true, otherInstance.id);
    const unrelatedCandidate = await db.documentRevision.create({
      data: {
        projectId: f.projectId,
        documentId: f.prdDocument.id,
        seq: 3,
        title: 'Unpublished future candidate',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('future'),
        byteLength: 6,
        sha256: digest,
        createdById: f.userId,
        basisUnderstandingRevisionId: f.understanding.id,
      },
    });
    await db.contextSnapshot.update({
      where: { id: historicalOnly.currentSnapshotId! },
      data: { manifest: { productBaseline: null, resources: [] } },
    });
    await db.artifactSetItem.create({
      data: {
        projectId: f.projectId,
        artifactSetId: historicalOnly.currentArtifactSetId!,
        candidateRevisionId: unrelatedCandidate.id,
      },
    });
    const historicalSet = await db.artifactSet.create({
      data: {
        projectId: f.projectId,
        taskId: historicalOnly.id,
        taskGeneration: 1,
        snapshotId: historicalOnly.currentSnapshotId!,
        manifestDigest: digest,
        workflowDefinitionRevisionId: f.revision.id,
        localRunId: randomUUID(),
        createdByStampId: f.stamp.id,
      },
    });
    await db.artifactSetItem.create({
      data: {
        projectId: f.projectId,
        artifactSetId: historicalSet.id,
        candidateRevisionId: f.prd.id,
      },
    });
    const beforeHistorical = await db.task.findUniqueOrThrow({ where: { id: historicalOnly.id } });
    const revision = await replacement(f);
    const result = await reviews.commitDecision(
      (await decision(f, { documentRevisionId: revision.id })).input,
    );
    expect(await db.task.findUnique({ where: { id: oldProducer.id } })).toMatchObject({
      version: acceptedProducer.version + 1,
      generation: 2,
      executionStatus: 'OPEN',
      currentSnapshotId: null,
      currentArtifactSetId: null,
    });
    expect(await db.task.findUnique({ where: { id: successor.id } })).toMatchObject({
      generation: 2,
    });
    expect(await db.task.findUnique({ where: { id: historicalOnly.id } })).toEqual(
      beforeHistorical,
    );
    expect(
      await db.reviewRequest.findUnique({ where: { id: acceptance.review.id } }),
    ).toMatchObject({ status: 'APPROVED', version: 2 });
    expect(
      await db.artifactSet.findUnique({ where: { id: oldProducer.currentArtifactSetId! } }),
    ).toMatchObject({ taskId: oldProducer.id, taskGeneration: 1 });
    const event = await db.changeEvent.findFirstOrThrow({
      where: { sourceId: result.publicationId! },
      include: { recipients: true },
    });
    expect((event.targets as { taskIds: string[] }).taskIds).toEqual(
      [oldProducer.id, successor.id].sort(),
    );
    expect(event.recipients.map((row) => row.roleId).sort()).toEqual(
      [f.roleIds.product, f.roleIds.release].sort(),
    );
  });

  it('allows one final publication under competing decisions and emits one task generation and event', async () => {
    const f = await fixture();
    const qa = await task(f, 'qa', 'qa', true);
    const revision = await replacement(f);
    const publication = await decision(f, { documentRevisionId: revision.id });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reviews.commitDecision({
          ...publication.input,
          operationId: randomUUID(),
          operationKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.task.findUnique({ where: { id: qa.id } })).toMatchObject({
      generation: 2,
      executionStatus: 'OPEN',
    });
    expect(
      await db.documentPublication.count({ where: { reviewRequestId: publication.review.id } }),
    ).toBe(1);
    expect(await db.changeEvent.count({ where: { projectId: f.projectId } })).toBe(1);
    expect(await db.changeRecipient.count({ where: { projectId: f.projectId } })).toBe(1);
  });

  it('rolls back publication, requirement, claims, reviews, event, ticket and operation on recipient failure', async () => {
    const f = await fixture();
    const qa = await task(f, 'qa', 'qa', true);
    const pending = await decision(
      f,
      { taskId: qa.id, artifactSetId: qa.currentArtifactSetId! },
      'TASK_ACCEPTANCE',
    );
    const revision = await replacement(f);
    const publication = await decision(f, { documentRevisionId: revision.id });
    const beforeRequirement = await db.requirement.findUniqueOrThrow({
      where: { id: f.requirementId },
    });
    const beforeDocument = await db.knowledgeDocument.findUniqueOrThrow({
      where: { id: f.prdDocument.id },
    });
    const constraint = `baseline_recipient_${randomUUID().replaceAll('-', '')}`;
    await db.$executeRawUnsafe(
      `ALTER TABLE workmesh_v1."ChangeRecipient" ADD CONSTRAINT "${constraint}" CHECK ("projectId" <> '${f.projectId}'::uuid) NOT VALID`,
    );
    try {
      await expect(reviews.commitDecision(publication.input)).rejects.toThrow();
      expect(await db.requirement.findUnique({ where: { id: f.requirementId } })).toEqual(
        beforeRequirement,
      );
      expect(await db.knowledgeDocument.findUnique({ where: { id: f.prdDocument.id } })).toEqual(
        beforeDocument,
      );
      expect(await db.task.findUnique({ where: { id: qa.id } })).toEqual(qa);
      expect(await db.taskClaim.findUnique({ where: { id: qa.currentClaimId! } })).toMatchObject({
        releasedAt: null,
      });
      expect(await db.reviewRequest.findUnique({ where: { id: pending.review.id } })).toMatchObject(
        { status: 'OPEN', version: 1 },
      );
      expect(
        await db.reviewRequest.findUnique({ where: { id: publication.review.id } }),
      ).toMatchObject({ status: 'OPEN', version: 1 });
      expect(
        await db.reviewDecision.count({ where: { reviewRequestId: publication.review.id } }),
      ).toBe(0);
      expect(
        await db.documentPublication.count({ where: { reviewRequestId: publication.review.id } }),
      ).toBe(0);
      expect(await db.changeEvent.count({ where: { projectId: f.projectId } })).toBe(0);
      expect(await db.changeRecipient.count({ where: { projectId: f.projectId } })).toBe(0);
      expect(
        await db.confirmationTicket.findUnique({ where: { id: publication.ticket.id } }),
      ).toMatchObject({ consumedAt: null });
      expect(
        await db.idempotentOperation.findUnique({ where: { id: publication.input.operationId } }),
      ).toBeNull();
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE workmesh_v1."ChangeRecipient" DROP CONSTRAINT "${constraint}"`,
      );
    }
    await expect(reviews.commitDecision(publication.input)).resolves.toMatchObject({
      published: true,
    });
    expect(await db.changeEvent.count({ where: { projectId: f.projectId } })).toBe(1);
  });

  it('clears the incompatible PRD after approved understanding and restores snapshots only after a new matching PRD', async () => {
    // A valid independent baseline consumer isolates snapshot recovery from PRODUCT delivery.
    const f = await fixture({ qaDeps: [] });
    await db.projectRoleAssignment.create({
      data: { projectId: f.projectId, userId: f.userId, roleId: f.roleIds.qa },
    });
    const qa = await task(f, 'qa', 'qa', true);
    const understanding = await db.documentRevision.create({
      data: {
        projectId: f.projectId,
        documentId: f.understandingDocument.id,
        seq: 2,
        title: 'Understanding 2',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('understanding 2'),
        byteLength: 15,
        sha256: digest,
        createdById: f.userId,
      },
    });
    // A candidate alone does not change the active baseline.
    expect(await db.requirement.findUnique({ where: { id: f.requirementId } })).toMatchObject({
      currentPrdRevisionId: f.prd.id,
    });
    const publication = await decision(
      f,
      { documentRevisionId: understanding.id },
      'UNDERSTANDING_CONFIRM',
    );
    await reviews.commitDecision(publication.input);
    expect(await db.requirement.findUnique({ where: { id: f.requirementId } })).toMatchObject({
      currentUnderstandingRevisionId: understanding.id,
      currentPrdRevisionId: null,
      deliveryScope: null,
      generation: 5,
      phase: 'RELEASED',
    });
    expect(
      await db.knowledgeDocument.findUnique({ where: { id: f.prdDocument.id } }),
    ).toMatchObject({ currentPublishedRevisionId: f.prd.id });
    const event = await db.changeEvent.findFirstOrThrow({ where: { projectId: f.projectId } });
    expect(event.changedFields).toEqual([
      'currentUnderstandingRevisionId',
      'currentPrdRevisionId',
      'deliveryScope',
      'generation',
    ]);
    const tasks = new V1TaskPrismaRepository(db as PrismaService);
    const snapshots = new V1SnapshotService(
      new V1SnapshotPrismaRepository(db as PrismaService),
      {
        resolveProjectContext: async () => ({}),
        requireScope: async () => undefined,
        resolveKnowledgeAccess: async () => ({ canRead: true }),
      } as unknown as V1AuthorizationService,
      new V1IdempotencyPrismaRepository(db as PrismaService),
    );
    async function snapshotAttempt() {
      const row = await db.task.findUniqueOrThrow({ where: { id: qa.id } });
      const claimed = await tasks.claim({
        taskId: qa.id,
        expectedGeneration: row.generation,
        principalScopeKey: `user:${f.userId}`,
        userId: f.userId,
        credentialId: null,
        now: new Date(),
        operation: {
          id: randomUUID(),
          projectScopeKey: `project:${f.projectId}`,
          principalScopeKey: `user:${f.userId}`,
          key: randomUUID(),
          method: 'POST',
          route: `/tasks/${qa.id}/claim`,
          requestDigest: digest,
        },
      });
      const body = { expectedVersion: claimed.version, claimId: claimed.currentClaim!.id };
      return snapshots.create(
        { kind: 'HUMAN', userId: f.userId, scopes: ['context:create', 'context:read'] },
        qa.id,
        body,
        {
          idempotencyKey: randomUUID(),
          method: 'POST',
          route: `/tasks/${qa.id}/snapshots`,
          body,
          now: new Date(),
          operationId: randomUUID(),
          webSessionId: f.sessionId,
          userAuthVersion: 1,
        },
      );
    }
    await expect(snapshotAttempt()).rejects.toMatchObject({
      message: 'SNAPSHOT_BASELINE_UNAVAILABLE',
    });
    const stalePrd = await replacement(f);
    const staleReview = await decision(f, { documentRevisionId: stalePrd.id });
    await expect(reviews.commitDecision(staleReview.input)).rejects.toMatchObject({
      message: 'PRD_BASIS_STALE',
    });
    expect(
      await db.confirmationTicket.findUnique({ where: { id: staleReview.ticket.id } }),
    ).toMatchObject({ consumedAt: null });
    const matchingPrd = await db.documentRevision.create({
      data: {
        projectId: f.projectId,
        documentId: f.prdDocument.id,
        seq: 3,
        title: 'PRD on Understanding 2',
        mimeType: 'text/plain',
        bodyBytes: Buffer.from('prd 3'),
        byteLength: 5,
        sha256: digest,
        createdById: f.userId,
        basisUnderstandingRevisionId: understanding.id,
        deliveryScope: { participatingRoleIds: [f.roleIds.qa] },
      },
    });
    await reviews.commitDecision((await decision(f, { documentRevisionId: matchingPrd.id })).input);
    const restored = await snapshotAttempt();
    expect(restored.snapshot.manifest).toMatchObject({
      productBaseline: { understandingRevisionId: understanding.id, prdRevisionId: matchingPrd.id },
    });
    expect(
      await db.contextSnapshot.findUnique({ where: { id: qa.currentSnapshotId! } }),
    ).toMatchObject({ requirementGeneration: 4 });
  });
});
