import { createHash, randomUUID } from "node:crypto";
import net from "node:net";

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_HOSTED_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_READY_PAGES = 50;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkmeshHttpError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "WorkmeshHttpError";
    this.code = code;
    if (status !== null) this.status = status;
  }
}

function fail(code, status = null) {
  throw new WorkmeshHttpError(code, status);
}

function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (net.isIP(normalized) !== 4) return false;
  const octets = normalized.split(".").map(Number);
  return octets.length === 4 && octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
}

function validateBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail("INVALID_BASE_URL");
  }
  if (
    url.protocol !== "http:" ||
    !isLoopbackHost(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    fail("LOOPBACK_HTTP_REQUIRED");
  }
  return url.origin;
}

async function readBoundedJson(response) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    fail("RESPONSE_INVALID");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail("RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("RESPONSE_INVALID");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.hasOwn(payload, "data")) {
    fail("ENVELOPE_INVALID");
  }
  return payload.data;
}

function validateRequestPath(origin, pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/api/v1/") || pathname.includes("#")) {
    fail("PATH_NOT_ALLOWED");
  }
  let url;
  try {
    url = new URL(pathname, origin);
  } catch {
    fail("PATH_NOT_ALLOWED");
  }
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/")) fail("PATH_NOT_ALLOWED");
  return url;
}

/**
 * A bounded loopback-only HTTP client for the WorkMesh v1 API.
 * The bearer token stays in this closure and is never included in errors or results.
 */
export function createWorkmeshClient({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  const origin = validateBaseUrl(baseUrl);
  if (typeof token !== "string" || token.length === 0 || token.length > 8192) fail("TOKEN_REQUIRED");
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE");

  return Object.freeze({
    async request(method, pathname, { body, idempotencyKey } = {}) {
      const verb = typeof method === "string" ? method.toUpperCase() : "";
      if (verb !== "GET" && verb !== "POST") fail("METHOD_NOT_ALLOWED");
      if (verb === "GET" && body !== undefined) fail("GET_BODY_NOT_ALLOWED");
      if (verb === "POST" && (!body || typeof body !== "object" || Array.isArray(body))) fail("POST_BODY_REQUIRED");
      if (verb === "POST" && (typeof idempotencyKey !== "string" || !UUID_PATTERN.test(idempotencyKey))) {
        fail("IDEMPOTENCY_KEY_INVALID");
      }

      const url = validateRequestPath(origin, pathname);
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      };
      const init = {
        method: verb,
        headers,
        redirect: "error",
      };
      if (verb === "POST") {
        const serialized = JSON.stringify(body);
        if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) fail("REQUEST_TOO_LARGE");
        headers["content-type"] = "application/json";
        headers["idempotency-key"] = idempotencyKey;
        init.body = serialized;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      init.signal = controller.signal;
      try {
        let response;
        try {
          response = await fetchImpl(url.toString(), init);
        } catch {
          fail(controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_FAILED");
        }
        if (!response || typeof response.status !== "number") fail("RESPONSE_INVALID");
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          fail("HTTP_ERROR", response.status);
        }
        try {
          return await readBoundedJson(response);
        } catch (error) {
          if (error instanceof WorkmeshHttpError) throw error;
          fail(controller.signal.aborted ? "REQUEST_TIMEOUT" : "RESPONSE_READ_FAILED");
        }
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

function requiredId(value, code) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) fail(code);
  return value;
}

function assertSameResourceDescriptor(expected, actual) {
  for (const key of ["refId", "kind", "targetId", "sha256", "byteLength", "mediaType", "authority"]) {
    if (expected?.[key] !== actual?.[key]) fail("SNAPSHOT_RESOURCES_MISMATCH");
  }
}

async function readSnapshotResources(client, snapshot) {
  const manifestResources = snapshot?.manifest?.resources;
  const snapshotResources = snapshot?.resources;
  if (!Array.isArray(manifestResources) || !Array.isArray(snapshotResources) || manifestResources.length !== snapshotResources.length) {
    fail("SNAPSHOT_RESOURCES_INVALID");
  }
  const snapshotByRefId = new Map();
  for (const resource of snapshotResources) {
    if (typeof resource?.refId !== "string" || snapshotByRefId.has(resource.refId)) fail("SNAPSHOT_RESOURCES_INVALID");
    snapshotByRefId.set(resource.refId, resource);
  }
  if (snapshotByRefId.size !== manifestResources.length) fail("SNAPSHOT_RESOURCES_INVALID");
  const snapshotId = requiredId(snapshot.id, "SNAPSHOT_INVALID");
  const hydrated = [];

  for (const descriptor of manifestResources) {
    const actualDescriptor = snapshotByRefId.get(descriptor?.refId);
    if (!actualDescriptor) fail("SNAPSHOT_RESOURCES_MISMATCH");
    assertSameResourceDescriptor(descriptor, actualDescriptor);
    if (!SHA256_PATTERN.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0) {
      fail("SNAPSHOT_RESOURCE_DESCRIPTOR_INVALID");
    }
    const refId = requiredId(descriptor.refId, "SNAPSHOT_RESOURCE_DESCRIPTOR_INVALID");
    const result = await client.request(
      "GET",
      `/api/v1/context-snapshots/${encodeURIComponent(snapshotId)}/resources/${encodeURIComponent(refId)}`,
    );
    if (result?.refId !== refId || result?.encoding !== "base64" || typeof result.bodyBase64 !== "string") {
      fail("SNAPSHOT_RESOURCE_INVALID");
    }
    const bytes = Buffer.from(result.bodyBase64, "base64");
    if (
      bytes.toString("base64") !== result.bodyBase64 ||
      result.byteLength !== descriptor.byteLength ||
      bytes.byteLength !== descriptor.byteLength ||
      result.sha256 !== descriptor.sha256 ||
      createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
    ) {
      fail("SNAPSHOT_RESOURCE_INTEGRITY_FAILED");
    }
    hydrated.push({ ...descriptor, bodyBytes: bytes });
  }
  return hydrated;
}

function taskPagePath(projectId, cursor) {
  const query = new URLSearchParams({ limit: "200" });
  if (cursor) query.set("cursor", cursor);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/ready?${query.toString()}`;
}

async function findReadyTask(client, projectId, taskId) {
  let cursor = null;
  for (let pageIndex = 0; pageIndex < MAX_READY_PAGES; pageIndex += 1) {
    const ready = await client.request("GET", taskPagePath(projectId, cursor));
    if (!ready || !Array.isArray(ready.items)) fail("READY_RESPONSE_INVALID");
    const task = ready.items.find((item) => item?.id === taskId);
    if (task) return { ready, task };
    if (!ready.hasMore || typeof ready.nextCursor !== "string" || ready.nextCursor.length === 0) break;
    cursor = ready.nextCursor;
  }
  fail("TASK_NOT_READY");
}

function testEvidenceFromRun(run) {
  const tests = Array.isArray(run.events)
    ? run.events
      .filter((event) => event?.tool === "run_tests")
      .map((event) => ({
        exitCode: event?.result?.exitCode ?? null,
        stdout: typeof event?.result?.stdout === "string" ? event.result.stdout : "",
        stderr: typeof event?.result?.stderr === "string" ? event.result.stderr : "",
      }))
    : [];
  return {
    exitCodes: [...run.testExitCodes],
    passed: true,
    trustedTestSha256: typeof run.trustedTestSha256 === "string" ? run.trustedTestSha256 : null,
    runs: tests,
  };
}

function validateRun(run, runId) {
  if (!run || run.ok !== true) fail("RUN_NOT_DELIVERABLE");
  if (run.runId !== runId) fail("RUN_ID_MISMATCH");
  if (typeof run.finalSource !== "string" || run.finalSource.length === 0) fail("FINAL_SOURCE_MISSING");
  if (!Array.isArray(run.testExitCodes) || run.testExitCodes.length !== 2 || run.testExitCodes[0] !== 1 || run.testExitCodes[1] !== 0) {
    fail("TEST_EVIDENCE_INVALID");
  }
  const actualHash = createHash("sha256").update(run.finalSource, "utf8").digest("hex");
  if (!SHA256_PATTERN.test(run.finalSourceSha256 ?? "") || actualHash !== run.finalSourceSha256) {
    fail("FINAL_SOURCE_INTEGRITY_FAILED");
  }
  if (Buffer.byteLength(run.finalSource, "utf8") > MAX_HOSTED_BYTES) fail("FINAL_SOURCE_TOO_LARGE");
  return {
    schemaVersion: "workmesh-api-agent-run/1",
    runId,
    snapshotId: null,
    manifestDigest: null,
    source: {
      mediaType: "text/javascript",
      sha256: actualHash,
      byteLength: Buffer.byteLength(run.finalSource, "utf8"),
      content: run.finalSource,
    },
    tests: testEvidenceFromRun(run),
  };
}

/**
 * Claim one ready task, materialize its immutable snapshot resources, run the caller's executor,
 * deliver a HOSTED IMPL artifact, and read the automatically-created review request.
 */
export async function runWorkmeshTask({ client, projectId, taskId, runId, execute } = {}) {
  if (!client || typeof client.request !== "function") fail("CLIENT_REQUIRED");
  projectId = requiredId(projectId, "PROJECT_ID_REQUIRED");
  taskId = requiredId(taskId, "TASK_ID_REQUIRED");
  runId = requiredId(runId, "RUN_ID_REQUIRED");
  if (runId.length > 120) fail("RUN_ID_INVALID");
  if (typeof execute !== "function") fail("EXECUTOR_REQUIRED");

  const { ready, task: readyTask } = await findReadyTask(client, projectId, taskId);
  if (readyTask.projectId !== projectId) fail("TASK_PROJECT_MISMATCH");

  const claim = await client.request(
    "POST",
    `/api/v1/tasks/${encodeURIComponent(taskId)}/claims`,
    { body: {}, idempotencyKey: randomUUID() },
  );
  if (
    !claim?.task ||
    claim.task.id !== taskId ||
    claim.task.projectId !== projectId ||
    !Number.isSafeInteger(claim.task.version) ||
    claim.task.version < 1 ||
    typeof claim.claimId !== "string" ||
    claim.claimId.length === 0
  ) fail("CLAIM_RESPONSE_INVALID");

  const snapshotCreation = await client.request(
    "POST",
    `/api/v1/tasks/${encodeURIComponent(taskId)}/context-snapshots`,
    {
      body: { expectedVersion: claim.task.version, claimId: claim.claimId },
      idempotencyKey: randomUUID(),
    },
  );
  if (!snapshotCreation?.snapshot || typeof snapshotCreation.taskVersion !== "number") fail("SNAPSHOT_CREATE_RESPONSE_INVALID");

  const createdSnapshot = snapshotCreation.snapshot;
  const snapshot = await client.request(
    "GET",
    `/api/v1/context-snapshots/${encodeURIComponent(requiredId(createdSnapshot.id, "SNAPSHOT_INVALID"))}`,
  );
  if (
    !snapshot ||
    snapshot.id !== createdSnapshot.id ||
    snapshot.taskId !== taskId ||
    snapshot.projectId !== projectId ||
    !snapshot.manifest ||
    snapshot.manifest.taskId !== taskId ||
    snapshot.manifest.projectId !== projectId ||
    typeof snapshot.manifestDigest !== "string" ||
    !SHA256_PATTERN.test(snapshot.manifestDigest) ||
    snapshot.manifestDigest !== createdSnapshot.manifestDigest ||
    snapshot.manifest.workflowDefinitionRevisionId !== createdSnapshot.manifest?.workflowDefinitionRevisionId
  ) {
    fail("SNAPSHOT_INVALID");
  }

  const resources = await readSnapshotResources(client, snapshot);
  const latestTask = await client.request("GET", `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (!latestTask || latestTask.id !== taskId || latestTask.projectId !== projectId || !Number.isSafeInteger(latestTask.version) || latestTask.version < 1) {
    fail("TASK_RESPONSE_INVALID");
  }
  if (latestTask.version !== snapshotCreation.taskVersion) fail("TASK_VERSION_CHANGED");

  const run = await execute({ runId, task: latestTask, snapshot, resources });
  const artifactBody = validateRun(run, runId);
  artifactBody.snapshotId = snapshot.id;
  artifactBody.manifestDigest = snapshot.manifestDigest;

  const hostedBytes = Buffer.from(JSON.stringify(artifactBody), "utf8");
  if (hostedBytes.byteLength > MAX_HOSTED_BYTES) fail("ARTIFACT_TOO_LARGE");
  const artifact = {
    kind: "IMPL",
    schemaVersion: "1.0",
    storage: "HOSTED",
    mediaType: "application/json",
    sha256: createHash("sha256").update(hostedBytes).digest("hex"),
    byteLength: hostedBytes.byteLength,
    bodyBase64: hostedBytes.toString("base64"),
    summary: `API Agent run ${runId}`,
    checks: [{
      code: "api-agent-tests",
      passed: true,
      message: "The executor reported a failing baseline followed by passing trusted tests.",
      source: "AGENT_REPORTED",
    }],
  };
  const deliveryBody = {
    expectedVersion: latestTask.version,
    claimId: claim.claimId,
    snapshotId: snapshot.id,
    workflowDefinitionRevisionId: snapshot.manifest.workflowDefinitionRevisionId,
    localRunId: runId,
    candidateRevisionIds: [],
    items: [artifact],
  };
  const deliveryRequest = { body: deliveryBody, idempotencyKey: randomUUID() };
  const delivery = await client.request(
    "POST",
    `/api/v1/tasks/${encodeURIComponent(taskId)}/artifact-sets`,
    deliveryRequest,
  );
  const reviewRequestId = requiredId(delivery?.reviewRequestId, "DELIVERY_RESPONSE_INVALID");
  if (!delivery.artifactSet || typeof delivery.artifactSet.id !== "string") fail("DELIVERY_RESPONSE_INVALID");
  const review = await client.request(
    "GET",
    `/api/v1/review-requests/${encodeURIComponent(reviewRequestId)}`,
  );
  if (!review || review.id !== reviewRequestId) fail("REVIEW_RESPONSE_INVALID");

  return { ready, claim, snapshot, resources, run, delivery, review, deliveryRequest };
}
