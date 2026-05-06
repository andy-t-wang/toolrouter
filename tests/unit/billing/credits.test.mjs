import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureCreditAccount,
  finalizeCreditReservation,
  markTopUpPending,
  reserveCredits,
  settleTopUp,
} from "../../../apps/api/src/billing.ts";
import { LocalStore } from "../../../packages/db/src/index.ts";

function store() {
  return new LocalStore({ path: join(mkdtempSync(join(tmpdir(), "toolrouter-billing-")), "store.json") });
}

describe("credit ledger", () => {
  it("reserves, captures, and releases request credits", async () => {
    const db = store();
    await db.upsertCreditAccount({
      user_id: "user_1",
      available_usd: "1.00",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });

    const reservation = await reserveCredits({
      store: db,
      user_id: "user_1",
      api_key_id: "key_1",
      trace_id: "trace_1",
      endpoint_id: "exa.search",
      amountUsd: "0.05",
    });
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).available_usd, "0.95");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).reserved_usd, "0.05");

    const finalized = await finalizeCreditReservation({
      store: db,
      reservation,
      amountUsd: "0.02",
      paymentReference: "0xpaid",
    });
    assert.equal(finalized.credit_captured_usd, "0.02");
    assert.equal(finalized.credit_released_usd, "0.03");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).available_usd, "0.98");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).reserved_usd, "0");
  });

  it("rejects reservations above available credits", async () => {
    const db = store();
    await ensureCreditAccount(db, "user_2");
    await db.upsertCreditAccount({
      user_id: "user_2",
      available_usd: "0.01",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });

    await assert.rejects(
      () =>
        reserveCredits({
          store: db,
          user_id: "user_2",
          amountUsd: "0.02",
        }),
      /insufficient ToolRouter credits/,
    );
  });

  it("settles top-up webhooks idempotently", async () => {
    const db = store();
    await markTopUpPending({
      store: db,
      user_id: "user_3",
      wallet_account_id: "wa_1",
      provider_reference: "cm_order_1",
      amountUsd: "10",
    });
    assert.equal((await db.getCreditAccount({ user_id: "user_3" })).pending_usd, "10");

    const first = await settleTopUp({ store: db, provider_reference: "cm_order_1", status: "success" });
    const second = await settleTopUp({ store: db, provider_reference: "cm_order_1", status: "success" });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const account = await db.getCreditAccount({ user_id: "user_3" });
    assert.equal(account.available_usd, "10");
    assert.equal(account.pending_usd, "0");
  });
});
