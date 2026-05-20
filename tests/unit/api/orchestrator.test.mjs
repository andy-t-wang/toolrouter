import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MemoryCache } from "../../../packages/cache/src/index.ts";
import { runExecution } from "../../../apps/api/src/services/execution/orchestrator.ts";

// Behavioral target for U8: `runExecution(...)` is unit-testable WITHOUT
// spinning up Fastify. This file exercises it directly with fake deps.

const auth = Object.freeze({
  user_id: "user_orch",
  api_key_id: "ak_orch",
  caller_id: "caller_orch",
});

function fakeStore() {
  const requests = [];
  const reservations = new Map();
  const ledger = [];
  let reservedAvailable = 100;
  return {
    requests,
    reservations,
    ledger,
    setAvailable(value) {
      reservedAvailable = value;
    },
    async insertRequest(row) {
      requests.push(row);
      return row;
    },
    async getCreditAccount({ user_id }) {
      return { user_id, available_usd: String(reservedAvailable), pending_usd: "0", reserved_usd: "0" };
    },
    async upsertCreditAccount(account) {
      return account;
    },
    async insertCreditReservation(row) {
      reservations.set(row.id, row);
      return row;
    },
    async getCreditReservation(id) {
      return reservations.get(id) || null;
    },
    async updateCreditReservation(row) {
      reservations.set(row.id, row);
      return row;
    },
    async insertCreditLedgerEntry(entry) {
      ledger.push(entry);
      return entry;
    },
  };
}

function fakeExecutor(impl) {
  const calls = [];
  return {
    calls,
    fn: async (args) => {
      calls.push(args);
      return impl(args);
    },
  };
}

describe("runExecution (orchestrator, Fastify-free)", () => {
  it("returns a success result without booting Fastify", async () => {
    const store = fakeStore();
    const executor = fakeExecutor(async () => ({
      ok: true,
      status_code: 200,
      path: "x402",
      charged: true,
      amount_usd: "0.02",
      currency: "USD",
      payment_reference: "ref_test",
      payment_network: "eip155:8453",
      body: { ok: true, query: "AgentKit" },
      latency_ms: 12,
    }));
    const cache = new MemoryCache();

    const result = await runExecution(
      {
        store,
        executor: executor.fn,
        cache,
        datadog: null,
        resolvePaymentSigner: async () => null,
      },
      {
        auth,
        body: {
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.05",
          payment_mode: "x402_only",
        },
        ip: "127.0.0.1",
      },
    );

    assert.equal(result.endpoint_id, "exa.search");
    assert.equal(result.path, "x402");
    assert.equal(result.charged, true);
    assert.equal(result.status_code, 200);
    assert.ok(result.id?.startsWith("req_"));
    assert.ok(result.trace_id?.startsWith("trace_"));
    assert.equal(executor.calls.length, 1);
    assert.equal(executor.calls[0].endpoint.id, "exa.search");
    assert.equal(executor.calls[0].paymentMode, "x402_only");
    assert.equal(store.requests.length, 1);
    assert.equal(store.requests[0].endpoint_id, "exa.search");
  });

  it("rejects missing endpoint_id with a 400-decorated error", async () => {
    const store = fakeStore();
    const executor = fakeExecutor(async () => ({ ok: true }));

    await assert.rejects(
      runExecution(
        {
          store,
          executor: executor.fn,
          cache: new MemoryCache(),
          datadog: null,
          resolvePaymentSigner: async () => null,
        },
        {
          auth,
          body: { input: {} },
        },
      ),
      (error) => {
        assert.equal(error.code, "invalid_request");
        assert.equal(error.statusCode, 400);
        assert.ok(error.trace_id?.startsWith("trace_"));
        return true;
      },
    );
    assert.equal(executor.calls.length, 0);
  });
});
