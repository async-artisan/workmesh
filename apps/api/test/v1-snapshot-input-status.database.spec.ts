import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import type { PrismaService } from '../src/prisma/prisma.service';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { V1SnapshotService } from '../src/tasks/v1-snapshot.service';
import { V1SnapshotPrismaRepository } from '../src/tasks/v1-snapshot.prisma-repository';
import {
  assembleSnapshotManifest,
  type V1SnapshotManifestResource,
} from '../src/tasks/v1-snapshot-policy';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

suite('PostgreSQL read-only task input boundaries', () => {
  let db: PrismaClient;
  let service: V1SnapshotService;
  let repository: V1SnapshotPrismaRepository;
  let userId: string;
  let principal: Principal;
  const projects: string[] = [];

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    expect(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name,
    ).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@input-status.test`, passwordHash: 'fixture' },
      })
    ).id;
    principal = { kind: 'HUMAN', userId, scopes: [] };
    const prisma = db as PrismaService;
    repository = new V1SnapshotPrismaRepository(prisma);
    service = new V1SnapshotService(
      repository,
      new V1AuthorizationService(new V1AuthorizationPrismaRepository(prisma)),
      new V1IdempotencyPrismaRepository(prisma),
    );
  });

  async function fixture() {
    const project = await db.project.create({
      data: { key: randomUUID().slice(0, 6), name: 'Input scope fixture', createdById: userId },
    });
    const projectId = project.id;
    projects.push(projectId);
    await db.projectMember.create({ data: { projectId, userId, role: 'MEMBER' } });
    const role = await db.projectRole.create({
      data: { projectId, key: 'dev', title: 'Developer' },
    });
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'IN-1', title: 'Input boundary' },
    });
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: 'input-scope' },
    });
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest: hash(projectId),
        definition: {
          steps: [
            { key: 'source', deps: [], baselinePolicy: 'NONE' },
            { key: 'target', deps: ['source'], baselinePolicy: 'NONE' },
          ],
        },
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
        stepKey: 'target',
        roleId: role.id,
        responsibleUserId: userId,
      },
    });
    const upstream = await db.task.create({
      data: {
        projectId,
        workflowInstanceId: instance.id,
        stepKey: 'source',
        roleId: role.id,
        responsibleUserId: userId,
        executionStatus: 'DONE',
      },
    });
    const stamp = await db.principalStamp.create({
      data: { projectId, kind: 'HUMAN', userId, scopeSnapshot: [], userAuthVersion: 1 },
    });
    const claim = await db.taskClaim.create({
      data: { projectId, taskId: task.id, taskGeneration: 1, userId },
    });
    const kb = await db.knowledgeBase.create({
      data: {
        projectId,
        key: 'knowledge',
        name: 'Knowledge',
        visibility: 'PROJECT',
        publicationApproverUserId: userId,
      },
    });
    return { projectId, role, requirement, revision, instance, task, upstream, stamp, claim, kb };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function document(f: Fixture, text = 'verified input') {
    const doc = await db.knowledgeDocument.create({
      data: { projectId: f.projectId, knowledgeBaseId: f.kb.id, kind: 'KNOWLEDGE' },
    });
    const bytes = Buffer.from(text);
    const revision = await db.documentRevision.create({
      data: {
        projectId: f.projectId,
        documentId: doc.id,
        seq: 1,
        title: 'Published knowledge',
        mimeType: 'text/plain',
        bodyBytes: bytes,
        sha256: hash(bytes),
        byteLength: bytes.length,
        createdById: userId,
      },
    });
    await db.knowledgeDocument.update({
      where: { id: doc.id },
      data: { currentPublishedRevisionId: revision.id },
    });
    const ref: V1SnapshotManifestResource = {
      refId: `knowledge:${doc.id}`,
      kind: 'DOCUMENT_REVISION',
      targetId: revision.id,
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      mediaType: revision.mimeType,
      authority: 'PUBLISHED',
    };
    return { doc, revision, ref };
  }

  async function snapshot(f: Fixture, resources: V1SnapshotManifestResource[] = []) {
    const assembled = await assembleSnapshotManifest({
      projectId: f.projectId,
      requirementId: f.requirement.id,
      requirementGeneration: 1,
      taskId: f.task.id,
      taskGeneration: 1,
      workflowDefinitionRevisionId: f.revision.id,
      workflowDigest: f.revision.digest,
      knowledgeBindingsVersion: 1,
      stepKey: 'target',
      baselinePolicy: 'NONE',
      productBaseline: null,
      resources,
    });
    const value = await db.contextSnapshot.create({
      data: {
        projectId: f.projectId,
        requirementId: f.requirement.id,
        taskId: f.task.id,
        taskGeneration: 1,
        requirementGeneration: 1,
        workflowDefinitionRevisionId: f.revision.id,
        claimId: f.claim.id,
        createdByStampId: f.stamp.id,
        manifest: assembled.manifest,
        manifestDigest: assembled.manifestDigest,
      },
    });
    for (const ref of resources)
      await db.snapshotResourceRef.create({
        data: {
          projectId: f.projectId,
          snapshotId: value.id,
          refKey: ref.refId,
          kind: ref.kind,
          sha256: ref.sha256,
          byteLength: ref.byteLength,
          mediaType: ref.mediaType,
          authority: ref.authority,
          documentRevisionId: ref.kind === 'DOCUMENT_REVISION' ? ref.targetId : null,
          artifactId: ref.kind === 'ARTIFACT' ? ref.targetId : null,
          rolePackageResourceId: ref.kind === 'ROLE_RESOURCE' ? ref.targetId : null,
        },
      });
    return value;
  }

  async function artifact(f: Fixture, storage: 'HOSTED' | 'GIT_REF' = 'HOSTED') {
    const set = await db.artifactSet.create({
      data: {
        projectId: f.projectId,
        taskId: f.upstream.id,
        taskGeneration: 1,
        snapshotId: randomUUID(),
        manifestDigest: hash('manifest'),
        workflowDefinitionRevisionId: f.revision.id,
        localRunId: randomUUID(),
        createdByStampId: f.stamp.id,
      },
    });
    const repo =
      storage === 'GIT_REF'
        ? await db.projectRepository.create({
            data: {
              projectId: f.projectId,
              identityMode: 'DECLARED',
              owner: 'fixture',
              name: 'input',
            },
          })
        : null;
    const bytes = Buffer.from('upstream evidence');
    const value = await db.artifact.create({
      data: {
        projectId: f.projectId,
        taskId: f.upstream.id,
        artifactSetId: set.id,
        kind: 'IMPL',
        schemaVersion: '1.0',
        storage,
        sha256: hash(bytes),
        byteLength: bytes.length,
        mediaType: 'text/plain',
        bodyBytes: storage === 'HOSTED' ? bytes : null,
        projectRepositoryId: repo?.id,
        commitSha: repo ? 'a'.repeat(40) : null,
        repoPath: repo ? 'src/index.ts' : null,
        checks: [],
        submittedByStampId: f.stamp.id,
      },
    });
    await db.reviewRequest.create({
      data: {
        projectId: f.projectId,
        taskId: f.upstream.id,
        taskGeneration: 1,
        artifactSetId: set.id,
        kind: 'TASK_ACCEPTANCE',
        status: 'APPROVED',
        subjectDigest: set.manifestDigest,
      },
    });
    await db.task.update({ where: { id: f.upstream.id }, data: { currentArtifactSetId: set.id } });
    return { value, set, repo };
  }

  it('keeps a task role version locked after a newer package is published and compares real resources only after workflow revision changes', async () => {
    const [own, foreign] = await Promise.all([fixture(), fixture()]);
    const packageId = `role-${randomUUID()}`;
    const oldBytes = Buffer.from('old task SOP');
    const newBytes = Buffer.from('new task SOP');
    const createPackage = (projectId: string, version: string, bytes: Buffer) =>
      db.rolePackageVersion.create({
        data: {
          projectId,
          packageId,
          version,
          roleKey: 'dev',
          manifest: {},
          manifestDigest: hash(`manifest:${version}`),
          resources: {
            create: {
              resourceKey: 'sop',
              path: 'skills/实现 SOP.md',
              mediaType: 'text/markdown',
              byteLength: bytes.length,
              sha256: hash(bytes),
              bodyBytes: bytes,
            },
          },
        },
        include: { resources: true },
      });
    const [oldPackage, newPackage] = await Promise.all([
      createPackage(own.projectId, '1.2.0', oldBytes),
      createPackage(own.projectId, '1.3.0', newBytes),
      createPackage(foreign.projectId, '9.0.0', newBytes),
    ]);
    const packageLock = (value: typeof oldPackage) => ({
      packageLocks: [
        { roleKey: 'dev', packageId, version: value.version, packageDigest: value.manifestDigest },
      ],
    });
    await db.workflowRevision.update({
      where: { id: own.revision.id },
      data: { compiledRules: packageLock(oldPackage) },
    });
    const resource = oldPackage.resources[0];
    const oldSnapshot = await snapshot(own, [
      {
        refId: 'role:sop',
        kind: 'ROLE_RESOURCE',
        targetId: resource.id,
        sha256: resource.sha256,
        byteLength: resource.byteLength,
        mediaType: resource.mediaType,
        authority: 'PUBLISHED',
      },
    ]);
    await db.task.update({
      where: { id: own.task.id },
      data: { currentSnapshotId: oldSnapshot.id },
    });
    const before = await db.task.findUniqueOrThrow({ where: { id: own.task.id } });
    const initial = await service.inspectInputs(principal, own.task.id);
    expect(initial.rolePackage).toMatchObject({
      status: 'LOCKED',
      locked: { version: '1.2.0' },
      latestAvailable: { version: '1.3.0' },
      comparison: { status: 'CURRENT', changes: [] },
    });
    expect(initial.resources).toContainEqual(
      expect.objectContaining({ refId: 'role:sop', targetId: resource.id, sha256: hash(oldBytes) }),
    );
    expect(await db.task.findUniqueOrThrow({ where: { id: own.task.id } })).toEqual(before);
    const revised = await db.workflowRevision.create({
      data: {
        projectId: own.projectId,
        definitionId: own.revision.definitionId,
        revision: 2,
        digest: hash('new workflow'),
        definition: own.revision.definition!,
        compiledRules: packageLock(newPackage),
      },
    });
    await db.workflowInstance.update({
      where: { id: own.instance.id },
      data: { definitionRevisionId: revised.id },
    });
    const changed = await service.inspectInputs(principal, own.task.id);
    expect(changed.rolePackage).toMatchObject({
      locked: { version: '1.3.0' },
      comparison: {
        status: 'CHANGED',
        changes: [
          {
            refId: 'role:sop',
            path: 'skills/实现 SOP.md',
            status: 'CHANGED',
            previousSha256: hash(oldBytes),
            currentSha256: hash(newBytes),
          },
        ],
      },
    });
    expect(await db.contextSnapshot.findUniqueOrThrow({ where: { id: oldSnapshot.id } })).toEqual(
      oldSnapshot,
    );
    expect(await db.task.findUniqueOrThrow({ where: { id: own.task.id } })).toEqual(before);
    expect(await db.contextSnapshot.count({ where: { taskId: own.task.id } })).toBe(1);
  });

  it('reports multiple exact missing inputs without mutating claim, task or snapshot state', async () => {
    const own = await fixture();
    const unpublished = await db.knowledgeDocument.create({
      data: { projectId: own.projectId, knowledgeBaseId: own.kb.id, kind: 'KNOWLEDGE' },
    });
    await db.projectKnowledgeBinding.create({
      data: { projectId: own.projectId, documentId: unpublished.id, required: true },
    });
    await db.workflowRevision.update({
      where: { id: own.revision.id },
      data: {
        compiledRules: {
          inputSources: [
            {
              stepKey: 'target',
              source: 'UPSTREAM_ARTIFACT',
              inputKey: 'contract',
              fromStepKey: 'source',
              reference: 'API_SPEC',
              required: true,
            },
          ],
        },
      },
    });
    const before = await db.task.findUniqueOrThrow({ where: { id: own.task.id } });
    const status = await service.inspectInputs(principal, own.task.id);
    expect(status).toMatchObject({ availability: 'UNAVAILABLE', issuesComplete: true });
    expect(status.issues).toEqual([
      expect.objectContaining({
        kind: 'KNOWLEDGE',
        documentId: unpublished.id,
        reason: 'NOT_PUBLISHED',
        action: 'PUBLISH_KNOWLEDGE',
        responsible: 'KNOWLEDGE_MAINTAINER',
      }),
      expect.objectContaining({
        kind: 'ARTIFACT',
        inputKey: 'contract',
        fromStepKey: 'source',
        artifactKind: 'API_SPEC',
        reason: 'ACCEPTED_ARTIFACT_MISSING',
        action: 'DELIVER_UPSTREAM',
      }),
    ]);
    expect(await db.task.findUniqueOrThrow({ where: { id: own.task.id } })).toEqual(before);
    expect(await db.contextSnapshot.count({ where: { projectId: own.projectId } })).toBe(0);
    expect(await db.taskClaim.count({ where: { taskId: own.task.id } })).toBe(1);
  });

  it('rejects a cross-project knowledge binding allowed by the database even when the user belongs to both projects', async () => {
    const [own, foreign] = await Promise.all([fixture(), fixture()]);
    const external = await document(foreign);
    await db.projectKnowledgeBinding.create({
      data: { projectId: own.projectId, documentId: external.doc.id, required: true },
    });
    const status = await service.inspectInputs(principal, own.task.id);
    expect(status).toMatchObject({ availability: 'UNAVAILABLE', resources: [] });
    expect(JSON.stringify(status)).not.toContain(external.revision.id);
    expect(JSON.stringify(status)).not.toContain(external.doc.id);
  });

  it('hides an unrelated current-snapshot pointer instead of comparing a foreign project', async () => {
    const [own, foreign] = await Promise.all([fixture(), fixture()]);
    const other = await snapshot(foreign);
    await db.task.update({ where: { id: own.task.id }, data: { currentSnapshotId: other.id } });
    const status = await service.inspectInputs(principal, own.task.id);
    expect(status).toMatchObject({
      snapshotId: null,
      availability: 'VERIFIED',
      comparison: { status: 'UNAVAILABLE', changes: [], metadataChanges: [] },
    });
    expect(JSON.stringify(status)).not.toContain(other.id);
  });

  it('rejects foreign artifact refs inside an otherwise readable snapshot before serving bytes', async () => {
    const [own, foreign] = await Promise.all([fixture(), fixture()]);
    const external = await artifact(foreign);
    const corrupt = await snapshot(own, [
      {
        refId: 'artifact:foreign',
        kind: 'ARTIFACT',
        targetId: external.value.id,
        sha256: external.value.sha256,
        byteLength: external.value.byteLength,
        mediaType: external.value.mediaType,
        authority: 'PUBLISHED',
      },
    ]);
    await expect(service.getSnapshot(principal, corrupt.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.getResource(principal, corrupt.id, 'artifact:foreign'),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await repository.verifyResourceContent(
        {
          kind: 'ARTIFACT',
          targetId: external.value.id,
          sha256: external.value.sha256,
          byteLength: external.value.byteLength,
          refId: 'artifact',
          mediaType: 'text/plain',
          authority: 'PUBLISHED',
        },
        own.projectId,
      ),
    ).toBe('UNAVAILABLE');
  });

  it('compares the same task historical generation and keeps old document read permission live', async () => {
    const own = await fixture();
    const old = await document(own);
    await db.projectKnowledgeBinding.create({
      data: { projectId: own.projectId, documentId: old.doc.id },
    });
    const historical = await snapshot(own, [old.ref]);
    await db.task.update({
      where: { id: own.task.id },
      data: { generation: 2, currentSnapshotId: historical.id },
    });
    expect((await service.inspectInputs(principal, own.task.id)).comparison).toMatchObject({
      status: 'CHANGED',
      metadataChanges: ['taskGeneration'],
    });
    await db.knowledgeBase.update({ where: { id: own.kb.id }, data: { visibility: 'RESTRICTED' } });
    expect(await service.inspectInputs(principal, own.task.id)).toMatchObject({
      availability: 'UNAVAILABLE',
      resources: [],
    });
    await expect(service.getSnapshot(principal, historical.id)).rejects.toMatchObject({
      status: 404,
    });
    await db.projectMember.update({
      where: { projectId_userId: { projectId: own.projectId, userId } },
      data: { revokedAt: new Date() },
    });
    await expect(service.inspectInputs(principal, own.task.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('exposes actual accepted Git refs only as a local check and refuses unsupported required snapshot creation', async () => {
    const own = await fixture();
    const git = await artifact(own, 'GIT_REF');
    await db.workflowRevision.update({
      where: { id: own.revision.id },
      data: {
        compiledRules: {
          inputSources: [
            {
              stepKey: 'target',
              source: 'UPSTREAM_ARTIFACT',
              inputKey: 'code',
              fromStepKey: 'source',
              reference: 'IMPL',
              required: true,
            },
          ],
        },
      },
    });
    await db.task.update({ where: { id: own.task.id }, data: { currentClaimId: own.claim.id } });
    const status = await service.inspectInputs(principal, own.task.id);
    expect(status).toMatchObject({
      availability: 'REQUIRES_LOCAL_CHECK',
      issue: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED',
      resources: [
        expect.objectContaining({ targetId: git.value.id, contentStatus: 'EXTERNAL_REFERENCE' }),
      ],
    });
    await expect(
      service.create(
        principal,
        own.task.id,
        { expectedVersion: 1, claimId: own.claim.id },
        {
          idempotencyKey: randomUUID(),
          operationId: randomUUID(),
          method: 'POST',
          route: '/test',
          body: {},
          now: new Date(),
          webSessionId: randomUUID(),
          userAuthVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 422, message: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED' });
    expect(await db.contextSnapshot.count({ where: { projectId: own.projectId } })).toBe(0);
    await db.projectRepository.update({
      where: { id: git.repo!.id },
      data: { archivedAt: new Date() },
    });
    expect((await service.inspectInputs(principal, own.task.id)).availability).toBe('UNAVAILABLE');
  });

  it('does not accept a predecessor set from another project or a stale generation', async () => {
    const [own, foreign] = await Promise.all([fixture(), fixture()]);
    const other = await artifact(foreign);
    await db.task.update({
      where: { id: own.upstream.id },
      data: { currentArtifactSetId: other.set.id },
    });
    expect(await repository.listAcceptedPrerequisiteArtifacts(own.task.id)).toEqual([]);
    await artifact(own);
    expect(await repository.listAcceptedPrerequisiteArtifacts(own.task.id)).toHaveLength(1);
    await db.task.update({ where: { id: own.upstream.id }, data: { generation: 2 } });
    expect(await repository.listAcceptedPrerequisiteArtifacts(own.task.id)).toEqual([]);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      const where = { projectId: { in: projects } };
      await db.snapshotResourceRef.deleteMany({ where });
      await db.contextSnapshot.deleteMany({ where });
      await db.rolePackageResource.deleteMany({ where: { packageVersion: where } });
      await db.rolePackageVersion.deleteMany({ where });
      await db.reviewRequest.deleteMany({ where });
      await db.artifact.deleteMany({ where });
      await db.artifactSet.deleteMany({ where });
      await db.projectRepository.deleteMany({ where });
      await db.projectKnowledgeBinding.deleteMany({ where });
      await db.documentRevision.deleteMany({ where });
      await db.knowledgeDocument.deleteMany({ where });
      await db.knowledgeBase.deleteMany({ where });
      await db.principalStamp.deleteMany({ where });
      await db.taskClaim.deleteMany({ where });
      await db.task.deleteMany({ where });
      await db.workflowInstance.deleteMany({ where });
      await db.workflowRevision.deleteMany({ where });
      await db.workflowDefinition.deleteMany({ where });
      await db.requirement.deleteMany({ where });
      await db.projectMember.deleteMany({ where });
      await db.projectRole.deleteMany({ where });
      await db.project.deleteMany({ where: { id: { in: projects } } });
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });
});
