import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SupabaseStore } from "../../../packages/db/src/index.ts";

function rpcCapturingStore(response = []) {
  const calls = [];
  const store = new SupabaseStore({
    url: "https://supabase.example",
    serviceRoleKey: "service-role-key",
  });
  store.request = async (path, options) => {
    calls.push({ path, options });
    return typeof response === "function" ? response(path, options) : response;
  };
  return { store, calls };
}

describe("Supabase store RPC accounting", () => {
  it("reserves credits through the atomic SQL RPC", async () => {
    const { store, calls } = rpcCapturingStore([
      {
        credit_reservation_id: "crr_1",
        credit_reserved_usd: "0.02",
        credit_captured_usd: "0",
        credit_released_usd: "0",
      },
    ]);

    const result = await store.reserveCredits({
      user_id: "00000000-0000-4000-8000-000000000001",
      amount_usd: "0.02",
      reservation_id: "crr_1",
      ledger_id: "cle_1",
      api_key_id: "key_1",
      trace_id: "trace_1",
      endpoint_id: "exa.search",
    });

    assert.equal(result.credit_reservation_id, "crr_1");
    assert.equal(calls[0].path, "/rpc/toolrouter_reserve_credits");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(calls[0].options.body, {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_amount_usd: "0.02",
      p_reservation_id: "crr_1",
      p_ledger_id: "cle_1",
      p_api_key_id: "key_1",
      p_trace_id: "trace_1",
      p_endpoint_id: "exa.search",
    });
  });

  it("finalizes credit reservations through the atomic SQL RPC", async () => {
    const { store, calls } = rpcCapturingStore([
      {
        credit_reservation_id: "crr_1",
        credit_reserved_usd: "0.02",
        credit_captured_usd: "0.007",
        credit_released_usd: "0.013",
      },
    ]);

    await store.finalizeCreditReservation({
      user_id: "00000000-0000-4000-8000-000000000001",
      reserved_usd: "0.02",
      captured_usd: "0.007",
      reservation_id: "crr_1",
      capture_ledger_id: "cle_capture",
      release_ledger_id: "cle_release",
      payment_reference: "pay_1",
      metadata: { trace_id: "trace_1" },
    });

    assert.equal(calls[0].path, "/rpc/toolrouter_finalize_credit_reservation");
    assert.deepEqual(calls[0].options.body, {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_reserved_usd: "0.02",
      p_captured_usd: "0.007",
      p_reservation_id: "crr_1",
      p_capture_ledger_id: "cle_capture",
      p_release_ledger_id: "cle_release",
      p_payment_reference: "pay_1",
      p_metadata: { trace_id: "trace_1" },
    });
  });

  it("rolls up API key request stats without PostgREST aggregates", async () => {
    const { store, calls } = rpcCapturingStore([
      { api_key_id: "key_a", ts: "2026-05-19T10:00:00.000Z" },
      { api_key_id: "key_a", ts: "2026-05-19T09:00:00.000Z" },
      { api_key_id: "key_b", ts: "2026-05-18T12:00:00.000Z" },
    ]);

    const stats = await store.listApiKeyStats({
      user_id: "00000000-0000-4000-8000-000000000001",
    });

    assert.equal(calls.length, 1);
    const [requestPath, queryString] = calls[0].path.split("?");
    assert.equal(requestPath, "/requests");
    const params = new URLSearchParams(queryString);
    assert.equal(params.get("user_id"), "eq.00000000-0000-4000-8000-000000000001");
    assert.equal(params.get("api_key_id"), "not.is.null");
    const select = params.get("select") || "";
    assert.doesNotMatch(select, /count\(\)/u, "must not call PostgREST count() aggregate");
    assert.doesNotMatch(select, /max\(\)/u, "must not call PostgREST max() aggregate");
    assert.match(select, /api_key_id/u);
    assert.match(select, /ts/u);

    const byKey = new Map(stats.map((row) => [row.api_key_id, row]));
    assert.equal(byKey.get("key_a").request_count, 2);
    assert.equal(byKey.get("key_a").last_used_at, "2026-05-19T10:00:00.000Z");
    assert.equal(byKey.get("key_b").request_count, 1);
    assert.equal(byKey.get("key_b").last_used_at, "2026-05-18T12:00:00.000Z");
  });

  it("pages through API key request rows to escape PostgREST db-max-rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      api_key_id: "key_a",
      ts: `2026-05-19T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
    }));
    const tailPage = [{ api_key_id: "key_a", ts: "2026-05-20T00:00:00.000Z" }];
    const responses = [fullPage, tailPage];
    const { store, calls } = rpcCapturingStore(() => responses.shift() ?? []);

    const stats = await store.listApiKeyStats({
      user_id: "00000000-0000-4000-8000-000000000001",
    });

    assert.equal(calls.length, 2, "must keep paging until short page");
    const offsets = calls.map((call) => {
      return new URLSearchParams(call.path.split("?")[1]).get("offset");
    });
    assert.deepEqual(offsets, ["0", "1000"]);

    const params = new URLSearchParams(calls[0].path.split("?")[1]);
    assert.equal(params.get("limit"), "1000");
    assert.match(params.get("order") || "", /id/u, "tiebreak by id so pages don't overlap");

    const byKey = new Map(stats.map((row) => [row.api_key_id, row]));
    assert.equal(byKey.get("key_a").request_count, 1001);
    assert.equal(byKey.get("key_a").last_used_at, "2026-05-20T00:00:00.000Z");
  });

  it("picks the latest last_used_at by instant, not lexical order", async () => {
    // `+00:00` ('+' = 0x2B) sorts before `Z` (0x5A) lexically, so a naive
    // `ts > last` comparison would prefer the older `Z` row over the newer
    // `+00:00` one even though both are UTC.
    const { store } = rpcCapturingStore([
      { api_key_id: "key_a", ts: "2026-05-19T10:00:00.000Z" },
      { api_key_id: "key_a", ts: "2026-05-19T10:00:01+00:00" },
    ]);

    const stats = await store.listApiKeyStats({
      user_id: "00000000-0000-4000-8000-000000000001",
    });

    assert.equal(stats[0].request_count, 2);
    assert.equal(stats[0].last_used_at, "2026-05-19T10:00:01+00:00");
  });

  it("settles credit purchases through the atomic SQL RPC", async () => {
    const { store, calls } = rpcCapturingStore({
      id: "cp_1",
      status: "funded",
    });

    const result = await store.settleCreditPurchase({
      purchase_id: "cp_1",
      wallet_account_id: "wa_1",
      funding_reference: "fund_1",
      funding_transaction_id: "tx_1",
      ledger_id: "cle_top_up",
      metadata: { stripe_event_id: "evt_1" },
    });

    assert.equal(result.status, "funded");
    assert.equal(calls[0].path, "/rpc/toolrouter_settle_credit_purchase");
    assert.deepEqual(calls[0].options.body, {
      p_purchase_id: "cp_1",
      p_wallet_account_id: "wa_1",
      p_funding_reference: "fund_1",
      p_funding_transaction_id: "tx_1",
      p_ledger_id: "cle_top_up",
      p_metadata: { stripe_event_id: "evt_1" },
    });
  });

  it("persists AgentMail inbox ownership through server-only PostgREST upserts", async () => {
    const created = {
      id: "ami_1",
      inbox_id: "inbox_123",
      email: "agent@agentmail.to",
      owner_address: "0x00000000000000000000000000000000000000a1",
    };
    const { store, calls } = rpcCapturingStore((path) =>
      path.startsWith("/agentmail_inboxes?on_conflict=inbox_id") ? [created] : [],
    );

    await store.upsertAgentmailInbox({
      inbox_id: "inbox_123",
      email: "agent@agentmail.to",
      owner_address: "0x00000000000000000000000000000000000000A1",
      metadata: { provider: "agentmail" },
    });

    const post = calls.find((call) => call.path === "/agentmail_inboxes?on_conflict=inbox_id");
    assert.ok(post, "must upsert by inbox_id after ownership preflight");
    assert.equal(post.options.method, "POST");
    assert.equal(post.options.prefer, "resolution=merge-duplicates,return=representation");
    assert.equal(post.options.body.inbox_id, "inbox_123");
    assert.equal(post.options.body.email, "agent@agentmail.to");
    assert.equal(post.options.body.owner_address, "0x00000000000000000000000000000000000000a1");
    assert.deepEqual(post.options.body.metadata, { provider: "agentmail" });
  });

  it("does not transfer AgentMail inbox ownership to another payer", async () => {
    const existing = {
      id: "ami_1",
      inbox_id: "inbox_123",
      email: "agent@agentmail.to",
      owner_address: "0x00000000000000000000000000000000000000a1",
    };
    const { store, calls } = rpcCapturingStore((path) =>
      path.includes("inbox_id=eq.inbox_123") ? [existing] : [],
    );

    await assert.rejects(
      () =>
        store.upsertAgentmailInbox({
          inbox_id: "inbox_123",
          email: "agent@agentmail.to",
          owner_address: "0x00000000000000000000000000000000000000b2",
        }),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, "agentmail_inbox_not_owned");
        return true;
      },
    );

    assert.equal(
      calls.some((call) => call.path === "/agentmail_inboxes?on_conflict=inbox_id"),
      false,
      "must reject before writing a different owner",
    );
  });

  it("repairs AgentMail health inbox ownership through an explicit server-only path", async () => {
    const existing = {
      id: "ami_1",
      inbox_id: "inbox_123",
      email: "agent@agentmail.to",
      owner_address: "0x00000000000000000000000000000000000000a1",
    };
    const repaired = {
      ...existing,
      owner_address: "0x00000000000000000000000000000000000000b2",
    };
    const { store, calls } = rpcCapturingStore((path) => {
      if (path.includes("inbox_id=eq.inbox_123")) return [existing];
      if (path.includes("id=eq.ami_1")) return [repaired];
      return [];
    });

    const row = await store.repairAgentmailHealthInboxOwner({
      inbox_id: "inbox_123",
      email: "agent@agentmail.to",
      owner_address: "0x00000000000000000000000000000000000000B2",
      metadata: { provider: "agentmail", health_probe: true },
    });

    assert.equal(row.owner_address, "0x00000000000000000000000000000000000000b2");
    const patch = calls.find((call) => call.path.includes("id=eq.ami_1"));
    assert.ok(patch, "must update the existing health fixture row by id");
    assert.equal(patch.options.method, "PATCH");
    assert.equal(patch.options.prefer, "return=representation");
    assert.equal(patch.options.body.owner_address, "0x00000000000000000000000000000000000000b2");
    assert.deepEqual(patch.options.body.metadata, { provider: "agentmail", health_probe: true });
  });

  it("finds AgentMail ownership records by inbox id before falling back to email", async () => {
    const responses = [
      [],
      [
        {
          inbox_id: "inbox_123",
          email: "agent@agentmail.to",
          owner_address: "0x00000000000000000000000000000000000000a1",
        },
      ],
    ];
    const { store, calls } = rpcCapturingStore(() => responses.shift() ?? []);

    const row = await store.findAgentmailInboxByIdentifier({
      identifier: "agent@agentmail.to",
    });

    assert.equal(row.inbox_id, "inbox_123");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].path.split("?")[0], "/agentmail_inboxes");
    assert.equal(new URLSearchParams(calls[0].path.split("?")[1]).get("inbox_id"), "eq.agent@agentmail.to");
    assert.equal(new URLSearchParams(calls[1].path.split("?")[1]).get("email"), "eq.agent@agentmail.to");
  });
});
