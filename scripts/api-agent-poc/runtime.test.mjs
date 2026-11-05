import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createFixture,
  createRuntime,
  runAgentLoop,
  runDemo,
} from "./runtime.mjs";

async function withFixture(fn) {
  const fixture = await createFixture();
  try {
    return await fn(fixture);
  } finally {
    await cleanupFixture(fixture);
  }
}

test("reads the only allowed source path", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const result = await runtime.invoke("read_file", { path: "src/format-task.mjs" });
    assert.equal(result.ok, true);
    assert.match(result.content, new RegExp(fixture.canary));
    assert.match(result.content, /formatTask/);
  });
});

test("writes the source file and changes it on disk", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const content = `export const CANARY = ${JSON.stringify(fixture.canary)};\nexport function formatTask(value) { return String(value).trim().toLowerCase().replace(/\\s+/g, "-"); }\n`;
    const result = await runtime.invoke("write_file", { path: "src/format-task.mjs", content });
    assert.equal(result.ok, true);
    assert.equal(await (await import("node:fs/promises")).readFile(fixture.sourcePath, "utf8"), content);
  });
});

test("the initial fixture fails the real trusted test process", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const result = await runtime.invoke("run_tests", {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TESTS_FAILED");
    assert.equal(result.exitCode, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /fail|AssertionError|not ok/i);
  });
});

test("a repaired source passes the real Node test process", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const fixed = `export const CANARY = ${JSON.stringify(fixture.canary)};\nexport function formatTask(value) { return String(value).trim().toLowerCase().replace(/\\s+/g, "-"); }\n`;
    assert.equal((await runtime.invoke("write_file", { path: "src/format-task.mjs", content: fixed })).ok, true);
    const result = await runtime.invoke("run_tests", {});
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
  });
});

test("sandboxed source cannot disable host assertions or exit the test process", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const canary = `export const CANARY = ${JSON.stringify(fixture.canary)};\n`;

    await runtime.invoke("write_file", {
      path: "src/format-task.mjs",
      content: `${canary}globalThis.assert = { equal: () => {} };\nexport function formatTask(value) { return value; }\n`,
    });
    const tamperAttempt = await runtime.invoke("run_tests", {});
    assert.equal(tamperAttempt.ok, false);
    assert.equal(tamperAttempt.error.code, "TESTS_FAILED");
    assert.match(tamperAttempt.stdout, /CASE_FAILED/);

    await runtime.invoke("write_file", {
      path: "src/format-task.mjs",
      content: `${canary}process.exit(0);\nexport function formatTask(value) { return value; }\n`,
    });
    const exitAttempt = await runtime.invoke("run_tests", {});
    assert.equal(exitAttempt.ok, false);
    assert.equal(exitAttempt.error.code, "TESTS_FAILED");
    assert.equal(exitAttempt.exitCode, 1);
    assert.match(exitAttempt.stdout, /SOURCE_EVALUATION_FAILED/);
  });
});

test("rejects sensitive files, traversal, backslashes, absolute paths, and test writes", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    for (const [name, args, code] of [
      ["read_file", { path: ".env" }, "PATH_NOT_ALLOWED"],
      ["read_file", { path: "../.env" }, "PATH_TRAVERSAL"],
      ["read_file", { path: "src\\format-task.mjs" }, "INVALID_PATH"],
      ["read_file", { path: path.resolve(fixture.workspace, "src/format-task.mjs") }, "INVALID_PATH"],
      ["write_file", { path: "test/format-task.test.mjs", content: "bad" }, "PATH_NOT_ALLOWED"],
    ]) {
      const result = await runtime.invoke(name, args);
      assert.equal(result.ok, false, `${name} should fail closed`);
      assert.equal(result.error.code, code);
    }
  });
});

test("rejects unknown tools and extra arguments", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const unknown = await runtime.invoke("exec_command", { command: "whoami" });
    assert.deepEqual(unknown.error.code, "UNKNOWN_TOOL");
    const extra = await runtime.invoke("read_file", { path: "src/format-task.mjs", command: "type" });
    assert.deepEqual(extra.error.code, "EXTRA_ARGUMENT");
    const extraTestArg = await runtime.invoke("run_tests", { command: "node" });
    assert.deepEqual(extraTestArg.error.code, "EXTRA_ARGUMENT");
  });
});

test("rejects source content over 8 KB", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    const result = await runtime.invoke("write_file", {
      path: "src/format-task.mjs",
      content: "x".repeat(8 * 1024 + 1),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "CONTENT_TOO_LARGE");
  });
});

test("rejects symlinked source paths when symlinks are available", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workmesh-api-agent-symlink-"));
  try {
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "outside");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(outside, "export function formatTask() {}\n", "utf8");
    try {
      await symlink(outside, path.join(workspace, "src", "format-task.mjs"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("the current Windows account cannot create symlinks");
        return;
      }
      throw error;
    }
    const runtime = createRuntime(workspace, {
      trustedTestFile: outside,
      trustedTestSha256: "0".repeat(64),
    });
    const result = await runtime.invoke("read_file", { path: "src/format-task.mjs" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SYMLINK_NOT_ALLOWED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records JSON-safe tool events with timing and result", async () => {
  await withFixture(async (fixture) => {
    const events = [];
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
      onEvent: (event) => events.push(event),
    });
    await runtime.invoke("read_file", { path: "src/format-task.mjs" });
    assert.equal(events.length, 1);
    assert.equal(events[0].tool, "read_file");
    assert.equal(events[0].args.path, "src/format-task.mjs");
    assert.equal(events[0].result.ok, true);
    assert.equal(typeof events[0].startedAt, "string");
    assert.equal(typeof events[0].durationMs, "number");
    assert.doesNotThrow(() => JSON.stringify(events[0]));
  });
});

test("the deterministic agent loop requires observed failure, repair, and passing tests", async () => {
  await withFixture(async (fixture) => {
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
    });
    let turn = 0;
    let observedCanary = null;
    const taskContext = JSON.stringify({ snapshotId: "snapshot-from-workmesh", manifestDigest: "d".repeat(64) });
    const outcome = await runAgentLoop({
      runtime,
      requiredCanary: fixture.canary,
      taskContext,
      chat: async ({ messages, tools: offeredTools }) => {
        const userFacingPrompt = messages
          .filter((message) => message.role === "system" || message.role === "user")
          .map((message) => message.content)
          .join("\n");
        assert.equal(userFacingPrompt.includes(fixture.canary), false);
        const toolMessages = messages.filter((message) => message.role === "tool");
        const lastToolResult = toolMessages.length ? JSON.parse(toolMessages[toolMessages.length - 1].content) : null;
        turn += 1;
        assert.equal(offeredTools.length, turn < 5 ? 1 : 0);
        if (turn < 5) {
          const expectedTool = ["read_file", "run_tests", "write_file", "run_tests"][turn - 1];
          assert.equal(offeredTools[0].function.name, expectedTool);
        }
        if (turn === 1) {
          assert.ok(messages.some((message) => message.role === "user" && message.content.includes(taskContext)));
          return { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "src/format-task.mjs" } } }] } };
        }
        if (turn === 2) {
          const match = lastToolResult.content.match(/^export const CANARY = "([a-f0-9]+)";/m);
          assert.ok(match);
          observedCanary = match[1];
          return { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "run_tests", arguments: {} } }] } };
        }
        if (turn === 3) {
          assert.equal(lastToolResult.error.code, "TESTS_FAILED");
          assert.match(lastToolResult.stdout, /CASE_FAILED/);
          const fixed = `export const CANARY = ${JSON.stringify(observedCanary)};\nexport function formatTask(value) { return String(value).trim().toLowerCase().replace(/\\s+/g, "-"); }\n`;
          return { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "write_file", arguments: { path: "src/format-task.mjs", content: fixed } } }] } };
        }
        if (turn === 4) {
          return { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "run_tests", arguments: {} } }] } };
        }
        assert.equal(lastToolResult.ok, true);
        return { message: { role: "assistant", content: `done\n${observedCanary}` } };
      },
    });
    assert.equal(outcome.turns, 5);
    assert.equal(observedCanary, fixture.canary);
    assert.equal(outcome.final, `done\n${fixture.canary}`);
    assert.deepEqual(outcome.state, {
      readSucceeded: true,
      initialTestFailed: true,
      writeSucceeded: true,
      postWriteTestPassed: true,
    });
  });
});

test("runDemo forwards bounded snapshot context and echoes the supplied run id", async () => {
  const originalFetch = globalThis.fetch;
  const taskContext = JSON.stringify({ snapshotId: "snapshot-from-workmesh", manifestDigest: "c".repeat(64) });
  let turn = 0;
  let canary = null;
  let contextObserved = false;

  function response(message) {
    return new Response(JSON.stringify({ message }), { status: 200, headers: { "content-type": "application/json" } });
  }

  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.messages.some((message) => message.role === "user" && message.content.includes(taskContext))) contextObserved = true;
    const lastTool = [...request.messages].reverse().find((message) => message.role === "tool");
    turn += 1;
    if (turn === 1) {
      return response({ role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "src/format-task.mjs" } } }] });
    }
    const readMessage = request.messages.find((message) => message.role === "tool" && message.tool_name === "read_file");
    if (readMessage) {
      const file = JSON.parse(readMessage.content);
      const match = file.content.match(/^export const CANARY = "([a-f0-9]+)";/m);
      canary = match?.[1] ?? null;
    }
    if (turn === 2) {
      return response({ role: "assistant", content: "", tool_calls: [{ function: { name: "run_tests", arguments: {} } }] });
    }
    if (turn === 3) {
      assert.equal(JSON.parse(lastTool.content).error.code, "TESTS_FAILED");
      const content = `export const CANARY = ${JSON.stringify(canary)};\nexport function formatTask(value) { return String(value).trim().toLowerCase().replace(/\\s+/g, "-"); }\n`;
      return response({ role: "assistant", content: "", tool_calls: [{ function: { name: "write_file", arguments: { path: "src/format-task.mjs", content } } }] });
    }
    if (turn === 4) {
      return response({ role: "assistant", content: "", tool_calls: [{ function: { name: "run_tests", arguments: {} } }] });
    }
    assert.equal(lastTool ? JSON.parse(lastTool.content).ok : false, true);
    return response({ role: "assistant", content: `Done\n${canary}` });
  };

  try {
    const result = await runDemo({ runId: "run-demo-test", taskContext });
    assert.equal(result.ok, true);
    assert.equal(result.runId, "run-demo-test");
    assert.equal(contextObserved, true);
    assert.deepEqual(result.testExitCodes, [1, 0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized task context before contacting the provider", async () => {
  await assert.rejects(
    runDemo({ runId: "run-demo-test", taskContext: "é".repeat(32 * 1024 + 1) }),
    (error) => error.code === "INVALID_TASK_CONTEXT",
  );
});

test("rejects multiple tool calls in one model response without executing either", async () => {
  await withFixture(async (fixture) => {
    const events = [];
    const runtime = createRuntime(fixture.workspace, {
      trustedTestFile: fixture.trustedTestFile,
      trustedTestSha256: fixture.trustedTestSha256,
      onEvent: (event) => events.push(event),
    });
    const original = await (await import("node:fs/promises")).readFile(fixture.sourcePath, "utf8");
    let turn = 0;
    const assistantResponses = [];
    await assert.rejects(
      runAgentLoop({
        runtime,
        requiredCanary: fixture.canary,
        maxTurns: 2,
        onAssistant: (response) => assistantResponses.push(response),
        chat: async () => {
          turn += 1;
          if (turn === 1) {
            return {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  { function: { name: "read_file", arguments: { path: "src/format-task.mjs" } } },
                  { function: { name: "write_file", arguments: { path: "src/format-task.mjs", content: "should not be written" } } },
                ],
              },
            };
          }
          return { message: { role: "assistant", content: "not complete" } };
        },
      }),
      (error) => error.code === "TURN_LIMIT",
    );
    const after = await (await import("node:fs/promises")).readFile(fixture.sourcePath, "utf8");
    assert.equal(after, original);
    assert.equal(events.length, 0);
    assert.equal(assistantResponses[0].rejection, "ONE_TOOL_PER_RESPONSE");
    assert.equal(assistantResponses[0].toolCalls.length, 2);
  });
});
