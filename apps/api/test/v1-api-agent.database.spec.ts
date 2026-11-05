import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { createWorkmeshClient, runWorkmeshTask } from '../../../scripts/api-agent-poc/workmesh-http.mjs';
import { runDemo } from '../../../scripts/api-agent-poc/runtime.mjs';

const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;
const origin = 'http://127.0.0.1:5173';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

suite('real API-driven Agent task execution with isolated PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let browser: ReturnType<typeof request.agent>;
  let csrf = '';
  let userId = '';
  let projectId = '';
  let roleId = '';
  let taskId = '';
  let credentialId = '';

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    vi.stubEnv('WORKMESH_V1_DATABASE_URL', target.url);
    vi.stubEnv('WORKMESH_COOKIE_MODE', 'LOCAL_INSECURE');
    vi.stubEnv('WORKMESH_PUBLIC_ORIGIN', origin);
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe(target.database);

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    browser = request.agent(app.getHttpServer());
  }, 60_000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await db?.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  function remember(response: request.Response) {
    const data = response.body?.data;
    if (typeof data?.csrfToken === 'string') csrf = data.csrfToken;
    if (typeof data?.session?.csrfToken === 'string') csrf = data.session.csrfToken;
    return response;
  }

  const humanPost = (path: string, body: object) =>
    browser
      .post(`/api/v1${path}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send(body)
      .then(remember);

  it('runs model tools, persists a hosted artifact, opens HUMAN review, and blocks Agent approval', async () => {
    const evidence: Record<string, unknown> = {
      schemaVersion: 'workmesh-api-agent-http-evidence/1',
      date: '2026-11-04',
      status: 'running',
      setup: { isolatedDatabaseVerified: true, appServer: 'ephemeral-loopback' },
    };
    let run: Record<string, unknown> | null = null;

    try {
      const session = remember(await browser.get('/api/v1/auth/session'));
      expect(session.status).toBe(200);
      expect(session.body.data.authenticated).toBe(false);
      const email = `api-agent-${randomUUID()}@http.test`;
      const password = `Api-agent-${randomUUID()}!`;
      const registered = await humanPost('/auth/register', { email, password, name: 'API Agent POC reviewer' });
      expect(registered.status).toBe(201);
      userId = registered.body.data.user.id;
      const storedUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(storedUser.passwordHash).not.toBe(password);

      const projectResponse = await humanPost('/projects', {
        name: 'API Agent isolated validation',
        key: Array.from(randomBytes(6), (byte) => String.fromCharCode(65 + (byte % 26))).join(''),
      });
      expect(projectResponse.status).toBe(201);
      projectId = projectResponse.body.data.id;
      const rolesResponse = remember(await browser.get(`/api/v1/projects/${projectId}/roles`));
      expect(rolesResponse.status).toBe(200);
      roleId = rolesResponse.body.data.find((role: { key: string }) => role.key === 'backend')?.id;
      expect(roleId).toBeTruthy();
      await db.projectRoleAssignment.upsert({
        where: { projectId_userId_roleId: { projectId, userId, roleId } },
        create: { projectId, userId, roleId },
        update: { revokedAt: null },
      });

      const definition = {
        schemaVersion: '1.0',
        protocolVersion: '1.0',
        workflowKey: 'api-agent-poc',
        title: 'API Agent POC',
        roleSlots: [{ key: 'accept', roleKey: 'backend', kind: 'TASK_ACCEPTANCE' }],
        roleExclusions: [],
        stepRemovals: [],
        steps: [{
          key: 'implementation',
          kind: 'IMPLEMENTATION',
          roleKey: 'backend',
          deps: [],
          outputKinds: ['IMPL'],
          baselinePolicy: 'NONE',
          gates: [{ mode: 'ALL', reviewerSlots: ['accept'] }],
        }],
      };
      const workflowKey = 'api-agent-poc';
      const definitionRow = await db.workflowDefinition.create({ data: { projectId, workflowKey } });
      const definitionDigest = hash(JSON.stringify(definition));
      const revision = await db.workflowRevision.create({
        data: {
          projectId,
          definitionId: definitionRow.id,
          revision: 1,
          digest: definitionDigest,
          definition,
          compiledRules: {
            resolvedRoles: [{ stepKey: 'implementation', roleKey: 'backend', roleId }],
            packageLocks: [{ roleKey: 'backend', packageId: 'api-agent-poc', version: '1.0.0' }],
            systemGates: [],
            inputSources: [],
          },
        },
      });
      const requirement = await db.requirement.create({
        data: {
          projectId,
          seq: 1,
          code: `POC-${randomUUID().slice(0, 6)}`,
          title: 'Prove model API execution can deliver through the WorkMesh API',
        },
      });
      const workflowInstance = await db.workflowInstance.create({
        data: {
          projectId,
          definitionId: definitionRow.id,
          definitionRevisionId: revision.id,
          definitionDigest,
          requirementId: requirement.id,
          bindings: { roleSlotBindings: [{ slotKey: 'accept', roleId, userId }] },
        },
      });
      const task = await db.task.create({
        data: {
          projectId,
          workflowInstanceId: workflowInstance.id,
          stepKey: 'implementation',
          roleId,
          responsibleUserId: userId,
        },
      });
      taskId = task.id;

      const roleInstructions = Buffer.from(
        '# API Agent POC role resource\nUse the immutable snapshot resource as task context; run the supplied tests before delivery.\n',
        'utf8',
      );
      const packageVersion = await db.rolePackageVersion.create({
        data: {
          projectId,
          packageId: 'api-agent-poc',
          version: '1.0.0',
          roleKey: 'backend',
          manifest: {},
          manifestDigest: hash('{}'),
        },
      });
      const roleResource = await db.rolePackageResource.create({
        data: {
          rolePackageVersionId: packageVersion.id,
          resourceKey: 'instructions',
          path: 'instructions.md',
          mediaType: 'text/markdown',
          byteLength: roleInstructions.byteLength,
          sha256: hash(roleInstructions),
          bodyBytes: roleInstructions,
        },
      });

      const verifier = randomBytes(32).toString('base64url');
      const credentialSecret = randomBytes(32).toString('base64url');
      const deviceResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/cli-authorizations')
        .send({
          clientName: 'API Agent POC',
          codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
          codeChallengeMethod: 'S256',
          credentialSecretHash: hash(credentialSecret),
        });
      expect(deviceResponse.status).toBe(201);
      const device = deviceResponse.body.data;
      expect(typeof device.deviceCode).toBe('string');

      const viewed = await humanPost('/auth/cli-authorizations/lookup', { userCode: device.userCode });
      expect(viewed.status).toBe(201);
      const scopes = ['task:read', 'task:claim', 'task:deliver', 'context:create', 'context:read', 'review:read'];
      const beforeForbiddenGrant = await db.agentCredential.count({ where: { userId, revokedAt: null } });
      const forbiddenGrant = await humanPost(`/auth/cli-authorizations/${device.authorizationId}/approve`, {
        expectedVersion: 1,
        projectId,
        roleId,
        scopes: [...scopes, 'review:approve'],
        expiresInDays: 1,
      });
      expect(forbiddenGrant.status).toBe(422);
      expect(await db.agentCredential.count({ where: { userId, revokedAt: null } })).toBe(beforeForbiddenGrant);

      const approved = await humanPost(`/auth/cli-authorizations/${device.authorizationId}/approve`, {
        expectedVersion: 1,
        projectId,
        roleId,
        scopes,
        expiresInDays: 1,
      });
      expect(approved.status).toBe(201);
      expect(approved.body.data.status).toBe('APPROVED');
      const issued = await request(app.getHttpServer())
        .post('/api/v1/auth/cli-authorizations/poll')
        .send({ authorizationId: device.authorizationId, deviceCode: device.deviceCode, codeVerifier: verifier });
      expect(issued.status).toBe(201);
      expect(issued.body.data.status).toBe('ISSUED');
      credentialId = issued.body.data.credential.credentialId;
      const credential = await db.agentCredential.findUniqueOrThrow({ where: { id: credentialId } });
      expect(credential.scopes).toEqual(scopes);
      expect(credential.tokenHash).toBe(hash(credentialSecret));

      const address = app.getHttpServer().address() as AddressInfo;
      const client = createWorkmeshClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        token: `wm_a1.${credentialId}.${credentialSecret}`,
      });
      const runId = `api-agent-${randomUUID()}`;
      const model = process.env.WORKMESH_POC_MODEL ?? 'qwen2.5:14b';
      let modelReceivedSnapshotResource = false;
      const result = await runWorkmeshTask({
        client,
        projectId,
        taskId,
        runId,
        execute: async ({ task: claimedTask, snapshot, resources }) => {
          const resourceTexts = resources.map((resource) => ({
            refId: resource.refId,
            sha256: resource.sha256,
            text: resource.bodyBytes.toString('utf8'),
          }));
          modelReceivedSnapshotResource = resourceTexts.some((resource) =>
            resource.text === roleInstructions.toString('utf8') && resource.sha256 === hash(roleInstructions));
          expect(claimedTask.id).toBe(taskId);
          expect(snapshot.taskId).toBe(taskId);
          expect(modelReceivedSnapshotResource).toBe(true);
          run = await runDemo({
            runId,
            model,
            taskContext: JSON.stringify({
              taskId: claimedTask.id,
              snapshotId: snapshot.id,
              manifestDigest: snapshot.manifestDigest,
              resources: resourceTexts,
            }),
          }) as unknown as Record<string, unknown>;
          return run;
        },
      });
      expect(result.run.ok).toBe(true);
      expect(result.run.runId).toBe(runId);
      expect(result.run.testExitCodes).toEqual([1, 0]);
      expect(result.snapshot.resources.some((resource: { targetId: string }) => resource.targetId === roleResource.id)).toBe(true);
      expect(result.review.status).toBe('OPEN');

      const artifactSetId = result.delivery.artifactSet.id;
      const persisted = await db.artifact.findFirstOrThrow({
        where: { artifactSetId },
        select: { bodyBytes: true, sha256: true, byteLength: true, submittedByStampId: true, checks: true },
      });
      const artifactBytes = Buffer.from(persisted.bodyBytes!);
      const artifactPayload = JSON.parse(artifactBytes.toString('utf8'));
      expect(persisted.sha256).toBe(hash(artifactBytes));
      expect(persisted.byteLength).toBe(artifactBytes.byteLength);
      expect(artifactPayload.source.content).toBe(result.run.finalSource);
      expect(artifactPayload.snapshotId).toBe(result.snapshot.id);
      expect(artifactPayload.manifestDigest).toBe(result.snapshot.manifestDigest);
      expect(persisted.checks).toMatchObject([{ code: 'api-agent-tests', source: 'AGENT_REPORTED', passed: true }]);
      const stamp = await db.principalStamp.findUniqueOrThrow({ where: { id: persisted.submittedByStampId } });
      expect(stamp).toMatchObject({ kind: 'AGENT', agentCredentialId: credentialId, projectId, roleId });
      const claimRow = await db.taskClaim.findUniqueOrThrow({ where: { id: result.claim.claimId } });
      expect(claimRow.credentialId).toBe(credentialId);

      const beforeReplay = await db.artifactSet.count({ where: { taskId } });
      const replay = await client.request(
        'POST',
        `/api/v1/tasks/${taskId}/artifact-sets`,
        result.deliveryRequest,
      );
      expect(replay.replayed).toBe(true);
      expect(replay.artifactSet.id).toBe(artifactSetId);
      expect(await db.artifactSet.count({ where: { taskId } })).toBe(beforeReplay);

      const review = await db.reviewRequest.findUniqueOrThrow({ where: { id: result.delivery.reviewRequestId } });
      const slot = await db.approvalSlot.findFirstOrThrow({ where: { reviewRequestId: review.id } });
      const agentDecision = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/review-requests/${review.id}/decisions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer wm_a1.${credentialId}.${credentialSecret}`,
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
          body: JSON.stringify({
            slotId: slot.id,
            decision: 'APPROVE',
            expectedVersion: review.version,
            confirmation: { ticketId: randomUUID(), ticketSecret: 'synthetic' },
          }),
        },
      );
      const agentDecisionBody = await agentDecision.json() as { error?: { code?: string } };
      expect(agentDecision.status).toBe(403);
      expect(agentDecisionBody.error?.code).toBe('HUMAN_SESSION_REQUIRED');
      const stillOpen = await db.reviewRequest.findUniqueOrThrow({ where: { id: review.id } });
      expect(stillOpen.status).toBe('OPEN');
      expect(await db.reviewDecision.count({ where: { reviewRequestId: review.id } })).toBe(0);

      const inbox = remember(await browser.get(`/api/v1/projects/${projectId}/review-requests?status=OPEN`));
      expect(inbox.status).toBe(200);
      expect(inbox.body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: review.id, status: 'OPEN' })]));

      const revoked = await browser
        .delete(`/api/v1/auth/credentials/${credentialId}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf);
      expect(revoked.status).toBe(200);
      const oldBearerResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/me`, {
        headers: { authorization: `Bearer wm_a1.${credentialId}.${credentialSecret}` },
      });
      expect(oldBearerResponse.status).toBe(401);

      evidence.status = 'passed';
      evidence.model = { provider: 'ollama', name: model, ok: result.run.ok, turns: result.run.turns, toolCalls: result.run.toolCalls, elapsedMs: result.run.elapsedMs, testExitCodes: result.run.testExitCodes };
      evidence.http = { readyTaskFound: true, claimed: true, snapshotCreated: true, snapshotResourcesHydrated: result.resources.length, modelReceivedSnapshotResource, hostedArtifactPersisted: true, artifactSetId, reviewRequestId: review.id, reviewStatus: stillOpen.status, agentDecisionStatus: agentDecision.status, agentDecisionCode: agentDecisionBody.error?.code, decisionsCreated: 0, deliveryReplay: replay.replayed, artifactSetsAfterReplay: beforeReplay, revokedCredentialRejected: oldBearerResponse.status === 401 };
      evidence.integrity = { artifactSha256Matches: persisted.sha256 === hash(artifactBytes), artifactByteLengthMatches: persisted.byteLength === artifactBytes.byteLength, agentStampMatchesCredential: stamp.agentCredentialId === credentialId, claimMatchesCredential: claimRow.credentialId === credentialId };
      evidence.fixture = { setup: 'direct Prisma workflow/task fixture plus real HTTP registration and project creation', roleResourceSha256: hash(roleInstructions), humanDeviceAuthorization: true, forbiddenAgentApprovalScopeRejected: forbiddenGrant.status === 422 };
      evidence.limits = ['local Ollama model inference', 'synthetic pure-function code fixture, not repository execution', 'direct Prisma setup for the workflow task fixture', 'HUMAN approval was simulated through a real session in this test; no approval decision was made'];
    } catch (error) {
      evidence.status = 'failed';
      evidence.failure = {
        name: error instanceof Error ? error.name : 'Error',
        code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null,
        status: typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null,
      };
      throw error;
    } finally {
      if (run) {
        evidence.modelTrace = {
          provider: run.provider,
          model: run.model,
          runId: run.runId,
          turns: run.turns,
          toolCalls: run.toolCalls,
          elapsedMs: run.elapsedMs,
          testExitCodes: run.testExitCodes,
          error: run.error ?? null,
          assistantResponses: Array.isArray(run.assistantResponses)
            ? (run.assistantResponses as Array<{ turn?: number; content?: string; toolCalls?: unknown[]; toolsOffered?: number }>).map((response) => ({
                turn: response.turn,
                contentPreview: response.content?.slice(0, 400) ?? '',
                toolCalls: response.toolCalls ?? [],
                toolsOffered: response.toolsOffered,
              }))
            : [],
          events: run.events,
          finalSourceSha256: run.finalSourceSha256,
          trustedTestSha256: run.trustedTestSha256,
        };
      }
      const outputPath = process.env.WORKMESH_POC_OUTPUT;
      if (outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      }
    }
  }, 240_000);
});
