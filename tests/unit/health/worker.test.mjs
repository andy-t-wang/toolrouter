import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getEndpoint, runEndpointHealthCheck } from "../../../packages/router-core/src/index.ts";

function createDb(requestRows = []) {
  const insertedHealthChecks = [];
  const upsertedStatuses = [];
  const endpointStatuses = [];
  return {
    insertedHealthChecks,
    upsertedStatuses,
    endpointStatuses,
    listRequestFilters: [],
    async listRequests(filters) {
      this.listRequestFilters.push(filters);
      return requestRows;
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

  it("retries failing endpoints on the shorter retry interval instead of waiting for the healthy cadence", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "failing",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 500,
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
      failureRetryIntervalMs: 15 * 60 * 1000,
    });

    assert.equal(executed, true);
    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks.length, 1);
  });

  it("skips degraded endpoints until the fixed retry interval elapses, without backing off further", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();
    db.endpointStatuses.push({
      endpoint_id: "browserbase.session",
      status: "degraded",
      last_checked_at: "2026-05-09T10:00:00.000Z",
      status_code: 402,
    });
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit_to_x402", charged: true };
      },
      now: () => new Date("2026-05-09T10:10:00.000Z"),
      minCheckIntervalMs: 12 * 60 * 60 * 1000,
      failureRetryIntervalMs: 15 * 60 * 1000,
    });

    assert.equal(executed, false);
    assert.equal(result.skipped, true);
    assert.equal(result.skip_reason, "failure_retry");
    assert.equal(result.next_check_after_ms, 15 * 60 * 1000);
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

  it("attributes a 5xx upstream failure to the upstream layer, not the payment layer", async () => {
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
    assert.equal(db.insertedHealthChecks[0].error, "Provider service error");
    assert.equal(db.upsertedStatuses[0].last_error, db.insertedHealthChecks[0].error);
  });

  it("attributes a 402 'Settlement failed' body to the facilitator layer with the canonical label", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 402,
        path: "agentkit_to_x402",
        charged: false,
        latency_ms: 900,
        body: { error: "Settlement failed: 402", transaction: "" },
      }),
      now: () => new Date("2026-05-19T16:13:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "degraded");
    assert.equal(db.insertedHealthChecks[0].error, "Settlement failed at facilitator");
    assert.equal(db.insertedHealthChecks[0].payment_error, "Settlement failed at facilitator");
    assert.equal(db.upsertedStatuses[0].last_error, "Settlement failed at facilitator");
  });

  it("does NOT degrade a clean unresolved x402 challenge envelope (protocol working, not a failure)", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 402,
        path: "x402",
        charged: false,
        latency_ms: 1_200,
        body: {
          x402Version: 1,
          accepts: [{ scheme: "exact", network: "eip155:8453" }],
        },
      }),
      now: () => new Date("2026-05-19T17:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(result.status, "healthy");
    assert.equal(db.insertedHealthChecks[0].error, null);
    assert.equal(db.insertedHealthChecks[0].payment_error, null);
  });

  it("writes per-layer health for a paid probe that settled and reached the upstream (U6)", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();

    await runEndpointHealthCheck({
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
      now: () => new Date("2026-05-20T10:00:00.000Z"),
      useRecentRequests: false,
    });

    const status = db.upsertedStatuses[0];
    assert.equal(status.layer_facilitator_status, "healthy");
    assert.equal(status.layer_upstream_status, "healthy");
    assert.equal(status.layer_transport_status, "healthy");
    assert.ok(status.layer_facilitator_updated_at);
    assert.ok(status.layer_upstream_updated_at);
    assert.ok(status.layer_transport_updated_at);
    // agentkit layer is NOT touched by a paid probe that served via agentkit_to_x402 fallback.
    // (Free trial wasn't realized — charged=true means we paid.) The plan keeps agentkit
    // untouched and lets the agentkit probe own that signal.
    assert.equal(status.layer_agentkit_status, undefined);
  });

  it("writes per-layer health for an agentkit probe served from the AgentKit path (U6)", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: true,
        status_code: 200,
        path: "agentkit",
        charged: false,
        latency_ms: 40,
      }),
      now: () => new Date("2026-05-20T10:00:00.000Z"),
      useRecentRequests: false,
      probeKind: "agentkit",
      updateEndpointStatus: true,
    });

    const status = db.upsertedStatuses[0];
    assert.equal(status.layer_agentkit_status, "healthy");
    assert.equal(status.layer_transport_status, "healthy");
    // Paid layers untouched on the agentkit probe.
    assert.equal(status.layer_facilitator_status, undefined);
    assert.equal(status.layer_upstream_status, undefined);
  });

  it("attributes a Settlement failed 402 to the facilitator layer in per-layer columns (U6)", async () => {
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 402,
        path: "agentkit_to_x402",
        charged: false,
        latency_ms: 900,
        body: { error: "Settlement failed: 402" },
      }),
      now: () => new Date("2026-05-20T10:00:00.000Z"),
      useRecentRequests: false,
    });

    const status = db.upsertedStatuses[0];
    assert.equal(status.layer_facilitator_status, "degraded");
    assert.equal(status.layer_transport_status, "healthy");
    // upstream was never reached because settlement failed before forward.
    assert.equal(status.layer_upstream_status, undefined);
  });

  it("attributes a 503 upstream failure to the upstream layer in per-layer columns (U6)", async () => {
    const endpoint = getEndpoint("browserbase.session");
    const db = createDb();

    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 503,
        path: "agentkit_to_x402",
        charged: true,
        latency_ms: 800,
        body: { error: "service unavailable" },
      }),
      now: () => new Date("2026-05-20T10:00:00.000Z"),
      useRecentRequests: false,
    });

    const status = db.upsertedStatuses[0];
    assert.equal(status.layer_upstream_status, "failing");
    assert.equal(status.layer_facilitator_status, "healthy");
    assert.equal(status.layer_transport_status, "healthy");
  });

  it("does NOT claim facilitator healthy on an upstream failure that took the AgentKit path", async () => {
    // Regression: when an agentkit_first probe served from AgentKit and the
    // upstream returned 4xx/5xx, the facilitator was never exercised. The
    // status row must omit `layer_facilitator_status` so the prior value is
    // preserved by the store's merge, NOT overwritten with a false recovery.
    const endpoint = getEndpoint("exa.search");
    const db = createDb();

    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: false,
        status_code: 500,
        path: "agentkit",
        charged: false,
        latency_ms: 600,
        body: { error: "upstream busy" },
      }),
      now: () => new Date("2026-05-20T10:30:00.000Z"),
      useRecentRequests: false,
      probeKind: "availability",
    });

    const status = db.upsertedStatuses[0];
    assert.equal(status.layer_upstream_status, "failing");
    assert.equal(status.layer_transport_status, "healthy");
    // Critical: facilitator key must be ABSENT (undefined), not "healthy".
    // Storage layers that respect "omitted = preserve" (PostgREST merge-
    // duplicates, LocalStore.upsertEndpointStatus) keep the prior value;
    // including `layer_facilitator_status: "healthy"` would falsely recover.
    assert.equal(status.layer_facilitator_status, undefined);
    assert.equal(status.layer_facilitator_updated_at, undefined);
  });

  it("preserves untouched layer columns across successive probes (LocalStore merge contract)", async () => {
    // U6 + this PR's defensive fix depend on the store preserving omitted
    // `layer_*` columns. LocalStore.upsertEndpointStatus merges; PostgREST's
    // resolution=merge-duplicates only updates columns present in the INSERT.
    // This test pins the contract end-to-end against LocalStore (Supabase's
    // behavior is documented in the migration; this is the in-memory mirror).
    const endpoint = getEndpoint("exa.search");
    const db = createDb();
    // Seed a prior status row with all four layers populated.
    db.endpointStatuses.push({
      endpoint_id: "exa.search",
      status: "degraded",
      last_checked_at: "2026-05-19T22:00:00.000Z",
      layer_facilitator_status: "degraded",
      layer_facilitator_updated_at: "2026-05-19T22:00:00.000Z",
      layer_agentkit_status: "healthy",
      layer_agentkit_updated_at: "2026-05-19T22:00:00.000Z",
      layer_upstream_status: "healthy",
      layer_upstream_updated_at: "2026-05-19T22:00:00.000Z",
      layer_transport_status: "healthy",
      layer_transport_updated_at: "2026-05-19T22:00:00.000Z",
    });

    // Run a successful AgentKit-only probe — touches only agentkit + transport.
    await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => ({
        ok: true,
        status_code: 200,
        path: "agentkit",
        charged: false,
        latency_ms: 300,
      }),
      now: () => new Date("2026-05-20T10:00:00.000Z"),
      useRecentRequests: false,
      probeKind: "agentkit",
      force: true,
    });

    const written = db.upsertedStatuses[0];
    // The status row should NOT contain keys for facilitator/upstream (so the
    // store's merge preserves the prior values).
    assert.equal(written.layer_agentkit_status, "healthy");
    assert.equal(written.layer_transport_status, "healthy");
    assert.equal(written.layer_facilitator_status, undefined);
    assert.equal(written.layer_upstream_status, undefined);
  });

  it("marks AgentMail create-inbox as manual-only instead of running recurring worker probes", async () => {
    const endpoint = getEndpoint("agentmail.create_inbox");
    const db = createDb();
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "x402", charged: true };
      },
      now: () => new Date("2026-05-20T11:00:00.000Z"),
      useRecentRequests: false,
    });

    assert.equal(executed, false);
    assert.equal(result.status, "unverified");
    assert.equal(db.insertedHealthChecks[0].error, "manual health probe");
    assert.equal(db.upsertedStatuses[0].status, "unverified");
  });

  it("skips AgentMail health probes when the configured test inbox env is missing", async () => {
    const previous = process.env.AGENTMAIL_HEALTH_INBOX_ID;
    delete process.env.AGENTMAIL_HEALTH_INBOX_ID;
    const endpoint = getEndpoint("agentmail.list_messages");
    const db = createDb();
    let executed = false;

    try {
      const result = await runEndpointHealthCheck({
        endpoint,
        db,
        executor: async () => {
          executed = true;
          return { ok: true, status_code: 200, path: "x402", charged: false };
        },
        now: () => new Date("2026-05-20T11:00:00.000Z"),
        useRecentRequests: false,
      });

      assert.equal(executed, false);
      assert.equal(result.status, "unverified");
      assert.equal(db.insertedHealthChecks[0].error, "missing health env: AGENTMAIL_HEALTH_INBOX_ID");
    } finally {
      if (previous === undefined) delete process.env.AGENTMAIL_HEALTH_INBOX_ID;
      else process.env.AGENTMAIL_HEALTH_INBOX_ID = previous;
    }
  });

  it("does not run AgentKit benefit probes for x402-only AgentMail endpoints", async () => {
    const endpoint = getEndpoint("agentmail.send_message");
    const db = createDb();
    let executed = false;

    const result = await runEndpointHealthCheck({
      endpoint,
      db,
      executor: async () => {
        executed = true;
        return { ok: true, status_code: 200, path: "agentkit" };
      },
      now: () => new Date("2026-05-20T11:00:00.000Z"),
      useRecentRequests: false,
      probeKind: "agentkit",
      updateEndpointStatus: false,
    });

    assert.equal(executed, false);
    assert.equal(result.status, "unverified");
    assert.equal(db.insertedHealthChecks[0].error, "agentkit probe not supported");
    assert.equal(db.upsertedStatuses.length, 0);
  });
});
