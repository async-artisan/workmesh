import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createWorkmeshClient, runWorkmeshTask, WorkmeshHttpError } from "./workmesh-http.mjs";

const PROJECT_ID = "project-1";
const TASK_ID = "task-1";
const RUN_ID = "api-run-2026-11-04";
const TOKEN = "workmesh-test-secret";
const resourceBytes = Buffer.from("# QA role instructions\nRun tests before delivery.\n", "utf8");
const resourceSha256 = createHash("sha256").update(resourceBytes).digest("hex");
const descriptor = {
  refId: "role-resource-qa",
  kind: "ROLE_RESOURCE",
  targetId: "resource-qa",
  sha256: resourceSha256,
  byteLength: resourceBytes.byteLength,
  mediaType: "text/markdown",
  authority: "PUBLISHED",
};
const snapshot = {
  id: "snapshot-1",
  projectId: PROJECT_ID,
  taskId: TASK_ID,
  manifestDigest: "a".repeat(64),
  manifest: {
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    workflowDefinitionRevisionId: "workflow-revision-1",
    resources: [descriptor],
  },
  resources: [descriptor],
};

function envelope(data, status = 200) {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchHarness({ resourceSha = resourceSha256, deliveryStatus = 200 } = {}) {
  const calls = [];
  const deliveryData = { artifactSet: { id: "artifact-set-1" }, task: { id: TASK_ID }, reviewRequestId: "review-1" };
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    calls.push({ url, init, headers });
    assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(init.redirect, "error");

    if (init.method === "GET" && url.pathname === `/api/v1/projects/${PROJECT_ID}/tasks/ready`) {
      assert.equal(url.searchParams.get("limit"), "200");
      return envelope({ items: [{ id: TASK_ID, projectId: PROJECT_ID, version: 2 }], nextCursor: null, hasMore: false });
    }
    if (init.method === "POST" && url.pathname === `/api/v1/tasks/${TASK_ID}/claims`) {
      assert.deepEqual(JSON.parse(init.body), {});
      return envelope({ task: { id: TASK_ID, projectId: PROJECT_ID, version: 3 }, claimId: "claim-1", replayed: false });
    }
    if (init.method === "POST" && url.pathname === `/api/v1/tasks/${TASK_ID}/context-snapshots`) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { expectedVersion: 3, claimId: "claim-1" });
      return envelope({ snapshot: { id: snapshot.id, manifest: snapshot.manifest, manifestDigest: snapshot.manifestDigest }, taskVersion: 3, replayed: false });
    }
    if (init.method === "GET" && url.pathname === `/api/v1/context-snapshots/${snapshot.id}`) return envelope(snapshot);
    if (init.method === "GET" && url.pathname === `/api/v1/context-snapshots/${snapshot.id}/resources/${descriptor.refId}`) {
      return envelope({
        refId: descriptor.refId,
        encoding: "base64",
        bodyBase64: resourceBytes.toString("base64"),
        byteLength: resourceBytes.byteLength,
        sha256: resourceSha,
      });
    }
    if (init.method === "GET" && url.pathname === `/api/v1/tasks/${TASK_ID}`) {
      return envelope({ id: TASK_ID, projectId: PROJECT_ID, version: 3 });
    }
    if (init.method === "POST" && url.pathname === `/api/v1/tasks/${TASK_ID}/artifact-sets`) {
      const body = JSON.parse(init.body);
      const artifact = body.items?.[0];
      assert.equal(body.localRunId, RUN_ID);
      assert.equal(body.snapshotId, snapshot.id);
      assert.equal(body.workflowDefinitionRevisionId, "workflow-revision-1");
      assert.deepEqual(body.candidateRevisionIds, []);
      assert.equal(artifact.kind, "IMPL");
      assert.equal(artifact.storage, "HOSTED");
      assert.equal(artifact.mediaType, "application/json");
      assert.equal(artifact.sha256, createHash("sha256").update(Buffer.from(artifact.bodyBase64, "base64")).digest("hex"));
      assert.equal(artifact.byteLength, Buffer.from(artifact.bodyBase64, "base64").byteLength);
      assert.deepEqual(artifact.checks, [{
        code: "api-agent-tests",
        passed: true,
        message: "The executor reported a failing baseline followed by passing trusted tests.",
        source: "AGENT_REPORTED",
      }]);
      const contents = JSON.parse(Buffer.from(artifact.bodyBase64, "base64").toString("utf8"));
      assert.equal(contents.runId, RUN_ID);
      assert.equal(contents.snapshotId, snapshot.id);
      assert.equal(contents.manifestDigest, snapshot.manifestDigest);
      assert.equal(contents.source.content, "export const result = true;\n");
      assert.deepEqual(contents.tests.exitCodes, [1, 0]);
      return envelope(deliveryData, deliveryStatus);
    }
    if (init.method === "GET" && url.pathname === "/api/v1/review-requests/review-1") {
      return envelope({ id: "review-1", status: "OPEN", taskId: TASK_ID });
    }
    throw new Error(`Unexpected request ${init.method} ${url.pathname}`);
  };
  return { calls, fetchImpl };
}

function executableRun() {
  const finalSource = "export const result = true;\n";
  return {
    ok: true,
    runId: RUN_ID,
    finalSource,
    finalSourceSha256: createHash("sha256").update(finalSource).digest("hex"),
    testExitCodes: [1, 0],
    trustedTestSha256: "b".repeat(64),
    events: [
      { tool: "run_tests", result: { exitCode: 1, stdout: "baseline failed", stderr: "" } },
      { tool: "run_tests", result: { exitCode: 0, stdout: "tests passed", stderr: "" } },
    ],
  };
}

test("runs the ready-to-review HTTP sequence and returns an idempotent delivery request", async () => {
  const { calls, fetchImpl } = createFetchHarness();
  const client = createWorkmeshClient({ baseUrl: "http://127.0.0.1:3400", token: TOKEN, fetchImpl });
  let executeArgs;
  const result = await runWorkmeshTask({
    client,
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    runId: RUN_ID,
    execute: async (args) => {
      executeArgs = args;
      return executableRun();
    },
  });

  assert.deepEqual(calls.map(({ init, url }) => `${init.method} ${url.pathname}`), [
    `GET /api/v1/projects/${PROJECT_ID}/tasks/ready`,
    `POST /api/v1/tasks/${TASK_ID}/claims`,
    `POST /api/v1/tasks/${TASK_ID}/context-snapshots`,
    `GET /api/v1/context-snapshots/${snapshot.id}`,
    `GET /api/v1/context-snapshots/${snapshot.id}/resources/${descriptor.refId}`,
    `GET /api/v1/tasks/${TASK_ID}`,
    `POST /api/v1/tasks/${TASK_ID}/artifact-sets`,
    "GET /api/v1/review-requests/review-1",
  ]);
  assert.ok(calls.filter(({ init }) => init.method === "POST").every(({ headers }) => /^[0-9a-f-]{36}$/i.test(headers.get("idempotency-key"))));
  assert.equal("authorization" in JSON.parse(calls.find(({ url }) => url.pathname.endsWith("artifact-sets")).init.body), false);
  assert.equal(executeArgs.runId, RUN_ID);
  assert.equal(executeArgs.resources[0].bodyBytes.toString("utf8"), resourceBytes.toString("utf8"));
  assert.deepEqual(Object.keys(executeArgs).sort(), ["resources", "runId", "snapshot", "task"]);
  assert.equal(result.review.status, "OPEN");
  assert.equal(result.delivery.reviewRequestId, "review-1");
  assert.deepEqual(result.deliveryRequest.body, JSON.parse(calls.find(({ url }) => url.pathname.endsWith("artifact-sets")).init.body));
  assert.match(result.deliveryRequest.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.equal(calls.some(({ url }) => url.pathname.includes("decisions")), false);
});

test("does not deliver when the executor reports a failed run", async () => {
  const { calls, fetchImpl } = createFetchHarness();
  const client = createWorkmeshClient({ baseUrl: "http://localhost:3400", token: TOKEN, fetchImpl });
  await assert.rejects(
    runWorkmeshTask({
      client,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      runId: RUN_ID,
      execute: async () => ({ ...executableRun(), ok: false }),
    }),
    (error) => error instanceof WorkmeshHttpError && error.code === "RUN_NOT_DELIVERABLE",
  );
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("artifact-sets")), false);
  assert.equal(calls.some(({ url }) => url.pathname.includes("review-requests")), false);
});

test("does not deliver when the executor returns a different run id", async () => {
  const { calls, fetchImpl } = createFetchHarness();
  const client = createWorkmeshClient({ baseUrl: "http://127.0.0.1:3400", token: TOKEN, fetchImpl });
  await assert.rejects(
    runWorkmeshTask({
      client,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      runId: RUN_ID,
      execute: async () => ({ ...executableRun(), runId: "another-run" }),
    }),
    (error) => error instanceof WorkmeshHttpError && error.code === "RUN_ID_MISMATCH",
  );
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("artifact-sets")), false);
});

test("rejects an unverified snapshot resource before invoking the executor", async () => {
  const { calls, fetchImpl } = createFetchHarness({ resourceSha: "0".repeat(64) });
  const client = createWorkmeshClient({ baseUrl: "http://[::1]:3400", token: TOKEN, fetchImpl });
  let executed = false;
  await assert.rejects(
    runWorkmeshTask({
      client,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      runId: RUN_ID,
      execute: async () => { executed = true; return executableRun(); },
    }),
    (error) => error instanceof WorkmeshHttpError && error.code === "SNAPSHOT_RESOURCE_INTEGRITY_FAILED",
  );
  assert.equal(executed, false);
  assert.equal(calls.some(({ init, url }) => init.method === "GET" && url.pathname === `/api/v1/tasks/${TASK_ID}`), false);
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("artifact-sets")), false);
});

test("keeps bearer tokens out of request errors and restricts transport to loopback HTTP", async () => {
  const client = createWorkmeshClient({
    baseUrl: "http://127.0.0.1:3400",
    token: TOKEN,
    fetchImpl: async () => { throw new Error(`transport failure ${TOKEN}`); },
  });
  await assert.rejects(
    client.request("GET", "/api/v1/tasks/task-1"),
    (error) => error.code === "REQUEST_FAILED" && !error.message.includes(TOKEN),
  );
  assert.throws(() => createWorkmeshClient({ baseUrl: "https://127.0.0.1:3400", token: TOKEN }), { code: "LOOPBACK_HTTP_REQUIRED" });
  assert.throws(() => createWorkmeshClient({ baseUrl: "http://example.com:3400", token: TOKEN }), { code: "LOOPBACK_HTTP_REQUIRED" });
});
