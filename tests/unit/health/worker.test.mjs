import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getEndpoint, runEndpointHealthCheck } from "../../../packages/router-core/src/index.ts";

function createDb(requestRows = []) {
  const insertedHealthChecks = [];
  const upsertedStatuses = [];
  return {
    insertedHealthChecks,
    upsertedStatuses,
    listRequestFilters: [],
    async listRequests(filters) {
      this.listRequestFilters.push(filters);
      return requestRows;
    },
    async insertHealthCheck(row) {
      insertedHealthChecks.push(row);
      return row;
    },
    async upsertEndpointStatus(row) {
      upsertedStatuses.push(row);
      return row;
    },
  };
}

describe("endpoint health worker", () => {
  it("reuses a recent successful AgentKit request instead of spending a new probe", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb([
      {
        id: "req_recent_agentkit",
        ts: "2026-05-09T10:00:00.000Z",
        endpoint_id: "exa.search",
        status_code: 200,
        ok: true,
        path: "agentkit",
        charged: false,
        estimated_usd: "0.007",
        amount_usd: null,
        currency: null,
        payment_reference: null,
        payment_network: null,
        payment_error: null,
        latency_ms: 321,
        error: null,
      },
    ]);
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit" };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      recentRequestWindowMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, false);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].checked_at, "2026-05-09T10:00:00.000Z");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit");
    assert.equal(db.upsertedStatuses[0].path, "agentkit");
    assert.equal(db.listRequestFilters[0].endpoint_id, "exa.search");
  });

  it("runs a probe when recent traffic did not exercise the AgentKit path", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb([
      {
        id: "req_recent_x402",
        ts: "2026-05-09T10:00:00.000Z",
        endpoint_id: "exa.search",
        status_code: 200,
        ok: true,
        path: "x402",
        charged: true,
      },
    ]);
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit",
          charged: false,
          latency_ms: 40,
        };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      recentRequestWindowMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, true);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].checked_at, "2026-05-09T11:00:00.000Z");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit");
  });

  it("passes the default health probe timeout to the executor", async () => {
    const previousTimeout = process.env.TOOLROUTER_HEALTH_PROBE_TIMEOUT_MS;
    delete process.env.TOOLROUTER_HEALTH_PROBE_TIMEOUT_MS;
    const endpoint = getEndpoint("exa.search");
    const db = createDb();
    let timeoutMs;

    try {
      await runEndpointHealthCheck({
        endpoint,
        db,
        executor: async (payload) => {
          timeoutMs = payload.timeoutMs;
          return {
            ok: true,
            status_code: 200,
            path: "agentkit",
            charged: false,
            latency_ms: 40,
          };
        },
        now: () => new Date("2026-05-09T11:00:00.000Z"),
        useRecentRequests: false,
      });
      assert.equal(timeoutMs, 5_000);
    } finally {
      if (previousTimeout === undefined) delete process.env.TOOLROUTER_HEALTH_PROBE_TIMEOUT_MS;
      else process.env.TOOLROUTER_HEALTH_PROBE_TIMEOUT_MS = previousTimeout;
    }
  });

  it("marks slow successful probes above the endpoint latency budget as degraded", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: true,
        status_code: 200,
        path: "agentkit",
        charged: false,
        latency_ms: 2_501,
      }),
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].latency_ms, 2_501);
    assert.equal(db.upsertedStatuses[0].status, "degraded");
  });

  it("marks reused recent requests above the endpoint latency budget as degraded", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb([
      {
        id: "req_recent_slow_agentkit",
        ts: "2026-05-09T10:00:00.000Z",
        endpoint_id: "exa.search",
        status_code: 200,
        ok: true,
        path: "agentkit",
        charged: false,
        latency_ms: 3_000,
        error: null,
      },
    ]);
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit" };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      recentRequestWindowMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, false);
    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].latency_ms, 3_000);
  });

  it("does not reuse a paid fallback as free-trial AgentKit evidence", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb([
      {
        id: "req_recent_paid_fallback",
        ts: "2026-05-09T10:00:00.000Z",
        endpoint_id: "exa.search",
        status_code: 200,
        ok: true,
        path: "agentkit_to_x402",
        charged: true,
      },
    ]);
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit",
          charged: false,
          latency_ms: 40,
        };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      recentRequestWindowMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, true);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit");
  });

  it("marks a free-trial paid fallback as degraded even when the provider call succeeds", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: true,
        status_code: 200,
        path: "agentkit_to_x402",
        charged: true,
        latency_ms: 40,
        amount_usd: "0.007",
      }),
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit_to_x402");
    assert.equal(db.insertedHealthChecks[0].charged, true);
  });

  it("allows AgentKit access endpoints to be healthy when they use x402 with AgentKit proof", async () => {
    const endpoint = getEndpoint("browserbase.search");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: true,
        status_code: 200,
        path: "agentkit_to_x402",
        charged: true,
        latency_ms: 40,
        amount_usd: "0.01",
      }),
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit_to_x402");
    assert.equal(db.insertedHealthChecks[0].charged, true);
  });

  it("persists safe provider body errors for failed health probes", async () => {
    const endpoint = getEndpoint("browserbase.fetch");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 500,
        path: "agentkit_to_x402",
        charged: false,
        latency_ms: 1_700,
        body: {
          error: "Failed to create payment intent",
          details: "amount is below provider minimum",
        },
      }),
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "failing");
    assert.equal(
      db.insertedHealthChecks[0].error,
      "Failed to create payment intent: amount is below provider minimum",
    );
    assert.equal(db.upsertedStatuses[0].last_error, db.insertedHealthChecks[0].error);
  });
});
