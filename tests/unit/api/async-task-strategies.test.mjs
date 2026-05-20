import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getAsyncTaskStrategyForEndpoint,
  prepareAsyncTask,
  finalizeAsyncTask,
  abandonAsyncTask,
} from "../../../apps/api/src/services/execution/async-task.ts";

function fakeStore() {
  const tasks = new Map();
  return {
    tasks,
    async findEndpointTaskByDedupeKey({ dedupe_key }) {
      for (const value of tasks.values()) {
        if (value.dedupe_key === dedupe_key) return value;
      }
      return null;
    },
    async findStartingEndpointTaskByDedupeKey({ dedupe_key }) {
      for (const value of tasks.values()) {
        if (value.dedupe_key === dedupe_key && !value.provider_task_id) return value;
      }
      return null;
    },
    async insertEndpointTask(row) {
      tasks.set(row.id, { ...row });
      return tasks.get(row.id);
    },
    async updateEndpointTask(row) {
      tasks.set(row.id, { ...row });
      return tasks.get(row.id);
    },
  };
}

const auth = Object.freeze({
  user_id: "user_1",
  api_key_id: "key_1",
  caller_id: "caller_1",
});

describe("AsyncTaskStrategy seam", () => {
  it("returns null for endpoints without a strategy", () => {
    assert.equal(getAsyncTaskStrategyForEndpoint({ id: "exa.search" }), null);
    assert.equal(getAsyncTaskStrategyForEndpoint(null), null);
  });

  it("resolves Manus and Parallel task strategies", () => {
    const manus = getAsyncTaskStrategyForEndpoint({ id: "manus.research" });
    assert.equal(manus?.endpointId, "manus.research");
    assert.equal(manus?.provider, "manus");
    const parallel = getAsyncTaskStrategyForEndpoint({ id: "parallel.task" });
    assert.equal(parallel?.endpointId, "parallel.task");
    assert.equal(parallel?.provider, "parallel");
  });

  it("dedupes Parallel task requests on identical input across calls", async () => {
    const store = fakeStore();
    const endpoint = { id: "parallel.task" };
    const endpointInput = { input: "Find latest agentic-payment news", processor: "core" };

    const first = await prepareAsyncTask({
      store,
      endpoint,
      endpointInput,
      body: { endpoint_id: endpoint.id, input: endpointInput },
      auth,
      traceId: "trace_a",
    });
    assert.equal(first.type, "reserved");
    assert.ok(first.dedupeKey);

    // Reservation row exists; orchestrator would then call executor. Simulate
    // by attaching a provider_task_id via finalizeAsyncTask.
    const result = {
      ok: true,
      body: { run_id: "run_abc", status: "queued" },
    };
    const start = await finalizeAsyncTask({
      store,
      strategy: first.strategy,
      endpoint,
      auth,
      result,
      reservedTask: first.reservedTask,
      dedupeKey: first.dedupeKey,
      requestId: "req_1",
      traceId: "trace_a",
      createdAt: new Date().toISOString(),
    });
    assert.equal(start.task_id, "run_abc");
    assert.equal(start.status, "running");
    assert.equal(start.task_created, true);

    // Second request with the same input → deduped (existing task returned).
    const second = await prepareAsyncTask({
      store,
      endpoint,
      endpointInput,
      body: { endpoint_id: endpoint.id, input: endpointInput },
      auth,
      traceId: "trace_b",
    });
    assert.equal(second.type, "deduped");
    assert.equal(second.response.endpoint_id, "parallel.task");
    assert.equal(second.response.deduped, true);
    assert.equal(second.response.task_id, "run_abc");
  });

  it("passes through when force_new is set", async () => {
    const store = fakeStore();
    const endpoint = { id: "parallel.task" };
    const endpointInput = { input: "anything", processor: "core" };

    const first = await prepareAsyncTask({
      store,
      endpoint,
      endpointInput,
      body: { endpoint_id: endpoint.id, input: endpointInput, force_new: true },
      auth,
      traceId: "trace_a",
    });
    assert.equal(first.type, "passthrough");
    assert.ok(first.dedupeKey, "dedupe key still computed for traceability");
  });

  it("abandons a reserved task on the error path without throwing", async () => {
    const store = fakeStore();
    const endpoint = { id: "parallel.task" };
    const endpointInput = { input: "boom", processor: "core" };

    const prep = await prepareAsyncTask({
      store,
      endpoint,
      endpointInput,
      body: { endpoint_id: endpoint.id, input: endpointInput },
      auth,
      traceId: "trace_a",
    });
    assert.equal(prep.type, "reserved");

    await assert.doesNotReject(
      abandonAsyncTask(store, prep.strategy, prep.reservedTask),
    );
    const row = store.tasks.get(prep.reservedTask.id);
    assert.equal(row.status, "error");
  });
});
