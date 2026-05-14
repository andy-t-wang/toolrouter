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
});
