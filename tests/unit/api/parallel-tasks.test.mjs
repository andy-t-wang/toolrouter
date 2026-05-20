import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PARALLEL_POLL_AFTER_SECONDS,
  PARALLEL_TASK_ENDPOINT_ID,
  dedupedParallelStartResponse,
  endpointTaskBase,
  normalizeParallelStatus,
  normalizedParallelTaskInput,
  parallelCreatedTaskFromBody,
  parallelDedupeKey,
  parallelResultPayload,
  parallelTaskStartPayload,
  pendingParallelResultPayload,
  taskPublicFields,
} from "../../../apps/api/src/services/parallel-tasks.ts";

describe("parallel-tasks helpers", () => {
  it("normalizes string and object inputs into a stable dedupe shape", () => {
    const stringInput = normalizedParallelTaskInput({
      input: "  Find   agentic payment APIs  ",
      processor: "core",
    });
    assert.equal(stringInput.input, "Find agentic payment APIs");
    assert.equal(stringInput.processor, "core");
    const objectInput = normalizedParallelTaskInput({
      input: { topic: "rate limits", sources: ["docs"] },
      processor: "core",
    });
    assert.ok(objectInput.input.includes("rate limits"));
    assert.equal(objectInput.processor, "core");
    assert.throws(
      () => normalizedParallelTaskInput({ input: "   " }),
      /input is required/u,
    );
  });

  it("dedupe key is stable across object-property ordering", () => {
    const a = parallelDedupeKey({ user_id: "u" }, { input: "x", processor: "core" });
    const b = parallelDedupeKey({ user_id: "u" }, { processor: "core", input: "x" });
    assert.equal(a, b);
    const c = parallelDedupeKey({ user_id: "u" }, { input: "y", processor: "core" });
    assert.notEqual(a, c);
  });

  it("maps Parallel status enum to ToolRouter lifecycle", () => {
    assert.equal(normalizeParallelStatus("queued"), "running");
    assert.equal(normalizeParallelStatus("running"), "running");
    assert.equal(normalizeParallelStatus("action_required"), "waiting");
    assert.equal(normalizeParallelStatus("completed"), "stopped");
    assert.equal(normalizeParallelStatus("failed"), "error");
    assert.equal(normalizeParallelStatus("cancelled"), "error");
  });

  it("extracts a Parallel run_id from upstream response shape", () => {
    const created = parallelCreatedTaskFromBody({ run_id: "run_xyz", status: "queued" });
    assert.equal(created.provider_task_id, "run_xyz");
    assert.equal(created.status, "queued");
    assert.equal(parallelCreatedTaskFromBody({}), null);
  });

  it("emits MCP-tool hints on the start payload", () => {
    const task = {
      provider_task_id: "run_1",
      status: "running",
      task_url: null,
      title: null,
    };
    const payload = parallelTaskStartPayload(task, {
      taskCreated: true,
      deduped: false,
      requestId: "req_1",
      traceId: "trace_1",
    });
    assert.equal(payload.task_id, "run_1");
    assert.equal(payload.poll_after_seconds, PARALLEL_POLL_AFTER_SECONDS);
    assert.equal(payload.next_mcp_tools.status, "parallel_task_status");
    assert.equal(payload.next_mcp_tools.result, "parallel_task_result");
    assert.equal(payload.next_api_routes.status, "/v1/parallel/tasks/run_1/status");
  });

  it("deduped response carries the existing task fields, not the new request id", () => {
    const existing = {
      id: "task_local",
      provider_task_id: "run_old",
      status: "queued",
      request_id: "req_old",
      trace_id: "trace_old",
    };
    const response = dedupedParallelStartResponse({ id: PARALLEL_TASK_ENDPOINT_ID }, existing, "trace_new");
    assert.equal(response.path, "deduped");
    assert.equal(response.deduped, true);
    assert.equal(response.task_id, "run_old");
    assert.equal(response.request_id, "req_old");
    assert.equal(response.trace_id, "trace_old");
  });

  it("endpointTaskBase stamps consistent fields", () => {
    const row = endpointTaskBase({
      endpoint: { id: PARALLEL_TASK_ENDPOINT_ID },
      auth: { user_id: "u", api_key_id: "k", caller_id: "c" },
      dedupeKey: "ddd",
    });
    assert.equal(row.endpoint_id, PARALLEL_TASK_ENDPOINT_ID);
    assert.equal(row.provider, "parallel");
    assert.equal(row.dedupe_key, "ddd");
    assert.equal(row.status, "running");
    assert.equal(row.provider_task_id, null);
  });

  it("result payload surfaces completed-state answer + citations", () => {
    const task = { provider_task_id: "run_1", status: "running" };
    const detail = { run: { status: "completed" } };
    const resultBody = {
      output: {
        type: "text",
        content: "Here is the answer.",
        basis: [
          {
            field: "result",
            citations: [
              { url: "https://example.com/a", title: "A", excerpts: ["..."] },
              { url: "https://example.com/b", title: null, excerpts: [] },
            ],
          },
        ],
      },
    };
    const payload = parallelResultPayload({ task, detail, resultBody });
    assert.equal(payload.status, "stopped");
    assert.equal(payload.final_answer_available, true);
    assert.equal(payload.answer, "Here is the answer.");
    assert.equal(payload.attachments.length, 2);
    assert.equal(payload.attachments[0].url, "https://example.com/a");
    assert.equal(payload.poll_after_seconds, null);
  });

  it("pending payload returns a poll_after_seconds while task row is reserved", () => {
    const task = { provider_task_id: null, status: "running", id: "task_a" };
    const pending = pendingParallelResultPayload(task);
    assert.equal(pending.poll_after_seconds, PARALLEL_POLL_AFTER_SECONDS);
    assert.equal(pending.status, "running");
    assert.equal(pending.final_answer_available, false);
  });

  it("taskPublicFields normalizes Parallel statuses", () => {
    const fields = taskPublicFields({ provider_task_id: "run", status: "completed" });
    assert.equal(fields.status, "stopped");
  });
});
