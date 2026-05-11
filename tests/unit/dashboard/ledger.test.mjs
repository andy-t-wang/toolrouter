import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compactLedgerEntries,
  ledgerAmountPolarity,
  ledgerAmountSign,
  ledgerTypeLabel,
} from "../../../apps/web/app/dashboard-ledger.ts";

describe("dashboard ledger presentation", () => {
  it("hides request accounting events from account credit activity", () => {
    const rows = compactLedgerEntries([
      {
        id: "reserve_1",
        ts: "2026-05-09T20:36:58.000Z",
        type: "reserve",
        source: "request",
        reference_id: "crr_request_1",
        amount_usd: "0.01",
      },
      {
        id: "capture_1",
        ts: "2026-05-09T20:37:07.000Z",
        type: "capture",
        source: "request",
        reference_id: "crr_request_1",
        amount_usd: "0.007",
      },
      {
        id: "release_1",
        ts: "2026-05-09T20:37:07.000Z",
        type: "release",
        source: "request",
        reference_id: "crr_request_1",
        amount_usd: "0.003",
      },
    ]);

    assert.equal(rows.length, 0);
  });

  it("hides fully returned request credits from the compact ledger", () => {
    const rows = compactLedgerEntries([
      {
        id: "reserve_2",
        ts: "2026-05-09T20:37:29.000Z",
        type: "reserve",
        source: "request",
        reference_id: "crr_request_2",
        amount_usd: "0.02",
      },
      {
        id: "release_2",
        ts: "2026-05-09T20:37:29.000Z",
        type: "release",
        source: "request",
        reference_id: "crr_request_2",
        amount_usd: "0.02",
      },
    ]);

    assert.equal(rows.length, 0);
  });

  it("keeps top-ups visible as positive credit rows", () => {
    const rows = compactLedgerEntries([
      {
        id: "top_up_1",
        ts: "2026-05-09T06:43:56.000Z",
        type: "top_up_settled",
        source: "stripe",
        reference_id: "cs_test",
        amount_usd: "5",
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(ledgerTypeLabel(rows[0].type), "Credits added");
    assert.equal(ledgerAmountPolarity(rows[0]), "positive");
    assert.equal(ledgerAmountSign(rows[0]), "+");
  });
});
