import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getEndpoint, runEndpointHealthCheck } from "../../../packages/router-core/src/index.ts";

function createDb(requestRows = []) {
  const insertedHealthChecks = [];
  const upsertedStatuses = [];
  const endpointStatuses = [];
  const healthChecks = [];
  return {
    insertedHealthChecks,
    upsertedStatuses,
    endpointStatuses,
    healthChecks,
    listRequestFilters: [],
    listHealthCheckFilters: [],
    async listRequests(filters) {
      this.listRequestFilters.push(filters);
      return requestRows;
    },
    async listHealthChecks(filters) {
      this.listHealthCheckFilters.push(filters);
      return healthChecks.filter((row) => !filters.endpoint_id || row.endpoint_id === filters.endpoint_id);
    },
    async listEndpointStatus() {
      return endpointStatuses;
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
  it("skips a probe when the endpoint was checked inside the cadence window", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "healthy",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 200,
    });
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit_to_x402", charged: true };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, false);
    assert.equal(result.skipped, true);
    assert.equal(result.skip_reason, "recent_health_check");
    assert.equal(db.insertedHealthChecks.length, 0);
    assert.equal(db.upsertedStatuses.length, 0);
  });

  it("runs a probe when the last endpoint status is outside the cadence window", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "healthy",
      last_checked_at: "2026-05-08T22:59:59.000Z",
      status_code: 200,
    });
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit_to_x402",
          charged: true,
          latency_ms: 40,
          amount_usd: "0.01",
        };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks.length, 1);
  });

  it("retries failed endpoints on the first backoff interval instead of waiting for the healthy cadence", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "failing",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 500,
    });
    db.healthChecks.push({
      endpoint_id: "browserbase.session",
      status: "failing",
      checked_at: "2026-05-09T10:00:00.000Z",
    });
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit_to_x402",
          charged: true,
          latency_ms: 40,
        };
      },
      now: () => new Date("2026-05-09T10:16:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
      failureRetryBaseMs: 15 * 60 * 1000,
      failureRetryMaxMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, true);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks.length, 1);
  });

  it("skips failed endpoints until their exponential backoff interval elapses", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "failing",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 500,
    });
    db.healthChecks.push(
      {
        endpoint_id: "browserbase.session",
        status: "failing",
        checked_at: "2026-05-09T10:00:00.000Z",
      },
      {
        endpoint_id: "browserbase.session",
        status: "failing",
        checked_at: "2026-05-09T09:44:00.000Z",
      },
    );
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit_to_x402", charged: true };
      },
      now: () => new Date("2026-05-09T10:20:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
      failureRetryBaseMs: 15 * 60 * 1000,
      failureRetryMaxMs: 12 * 60 * 60 * 1000,
    });

    assert.equal(executed, false);
    assert.equal(result.skipped, true);
    assert.equal(result.skip_reason, "failure_backoff");
    assert.equal(result.consecutive_failures, 2);
    assert.equal(result.next_check_after_ms, 30 * 60 * 1000);
  });

  it("allows forced probes to bypass the cadence guard", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "healthy",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 200,
    });
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit_to_x402",
          charged: true,
          latency_ms: 40,
          amount_usd: "0.01",
        };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
      force: true,
    });

    assert.equal(executed, true);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks.length, 1);
  });

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
    assert.equal(db.insertedHealthChecks[0].checked_at, "2026-05-09T11:00:00.000Z");
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

  it("passes endpoint-specific health probe timeouts to the executor", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    let timeoutMs;

    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async (payload) => {
        timeoutMs = payload.timeoutMs;
        return {
          ok: true,
          status_code: 200,
          path: "agentkit_to_x402",
          charged: true,
          latency_ms: 40,
        };
      },
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(timeoutMs, 15_000);
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
        latency_ms: 10_001,
      }),
      now: () => new Date("2026-05-09T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].latency_ms, 10_001);
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
        latency_ms: 10_001,
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
    assert.equal(db.insertedHealthChecks[0].latency_ms, 10_001);
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

  it("keeps free-trial endpoints healthy when the paid availability path succeeds", async () => {
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

    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit_to_x402");
    assert.equal(db.insertedHealthChecks[0].charged, true);
  });

  it("does not let AgentKit benefit checks overwrite endpoint availability status", async () => {
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
      probeKind: "agentkit",
      updateEndpointStatus: false,
    });

    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].path, "agentkit_to_x402");
    assert.equal(db.upsertedStatuses.length, 0);
  });

  it("allows AgentKit access endpoints to be healthy when they use x402 with AgentKit proof", async () => {
    const endpoint = getEndpoint("browserbase.session");
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

  it("sanitizes provider body errors for failed health probes", async () => {
    const endpoint = getEndpoint("browserbase.session");
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
      "Provider payment error",
    );
    assert.equal(db.upsertedStatuses[0].last_error, db.insertedHealthChecks[0].error);
  });
});
