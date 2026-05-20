import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attributeFailure,
  agentRequestLabel,
} from "../../../packages/router-core/src/attribution.ts";

describe("attributeFailure — successful responses", () => {
  it("returns null for a 200 OK with no error", () => {
    assert.equal(attributeFailure({ status_code: 200, ok: true }), null);
  });

  it("returns null for ok=true with no status code", () => {
    assert.equal(attributeFailure({ ok: true }), null);
  });

  it("returns null for null/undefined input", () => {
    assert.equal(attributeFailure(null), null);
    assert.equal(attributeFailure(undefined), null);
  });
});

describe("attributeFailure — x402 challenge envelopes", () => {
  it("returns null for a clean unresolved challenge (protocol working, not a failure)", () => {
    const result = attributeFailure({
      status_code: 402,
      body: {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "7000",
            payTo: "0x6d6E695b09861467c7d462f5AAF31cF3540B9192",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        ],
        extensions: { agentkit: { supportedChains: [{ chainId: "eip155:480" }] } },
      },
    });
    assert.equal(result, null);
  });

  it("returns null for a v1 challenge body", () => {
    const result = attributeFailure({
      status_code: 402,
      body: {
        x402Version: 1,
        accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "10000" }],
      },
    });
    assert.equal(result, null);
  });

  it("attributes a 402 with no marker and no payment_error as agentkit (challenge active)", () => {
    const result = attributeFailure({ status_code: 402 });
    assert.equal(result.layer, "agentkit");
    assert.equal(result.label, "AgentKit challenge active");
    assert.equal(result.retryable, true);
  });
});

describe("attributeFailure — facilitator settlement failures", () => {
  it("attributes Exa's 'Settlement failed: 402' body to facilitator", () => {
    const result = attributeFailure({
      status_code: 402,
      body: { error: "Settlement failed: 402", transaction: "" },
    });
    assert.equal(result.layer, "facilitator");
    assert.equal(result.label, "Settlement failed at facilitator");
    assert.equal(result.retryable, true);
  });

  it("attributes Browserbase's 'Failed to settle payment' body to facilitator", () => {
    const result = attributeFailure({
      status_code: 402,
      body: {
        error: "Failed to settle payment: 402 Payment Required",
        paymentIntentId: "pi_3TZ25LGhqv5yXZ431sDLgeSM",
      },
    });
    assert.equal(result.layer, "facilitator");
    assert.equal(result.label, "Settlement failed at facilitator");
    assert.equal(result.retryable, true);
  });

  it("recognizes settlement failure even when the body has a challenge-shaped accepts array", () => {
    // Some sellers return both an updated challenge AND a settlement-failure
    // marker in the same body. Settlement-failure attribution wins.
    const result = attributeFailure({
      status_code: 402,
      body: {
        x402Version: 2,
        accepts: [{ scheme: "exact", network: "eip155:8453" }],
        error: "Settlement failed",
      },
    });
    assert.equal(result.layer, "facilitator");
  });
});

describe("attributeFailure — router-side payment errors", () => {
  it("attributes a 402 with wallet payment_error to router_payment", () => {
    const result = attributeFailure({
      status_code: 402,
      payment_error: "wallet not configured",
    });
    assert.equal(result.layer, "router_payment");
    assert.equal(result.label, "Router wallet signing failed");
    assert.equal(result.retryable, false);
  });

  it("attributes a 402 with signer payment_error to router_payment", () => {
    const result = attributeFailure({
      status_code: 402,
      payment_error: "Crossmint signer rejected the request",
    });
    assert.equal(result.layer, "router_payment");
  });

  it("attributes opaque 402 with non-wallet payment_error as router_payment fallback", () => {
    const result = attributeFailure({
      status_code: 402,
      payment_error: "generic payment failure",
    });
    assert.equal(result.layer, "router_payment");
    assert.equal(result.label, "Router payment failed");
  });
});

describe("attributeFailure — non-402 layer attribution", () => {
  it("429 → rate_limit", () => {
    const result = attributeFailure({ status_code: 429 });
    assert.equal(result.layer, "rate_limit");
    assert.equal(result.label, "Provider rate limited");
    assert.equal(result.retryable, true);
  });

  it("504 → timeout", () => {
    const result = attributeFailure({ status_code: 504 });
    assert.equal(result.layer, "timeout");
    assert.equal(result.label, "Provider timed out");
    assert.equal(result.retryable, true);
  });

  it("error mentioning 'timed out' without status_code → timeout", () => {
    const result = attributeFailure({ error: "request timed out after 8000ms" });
    assert.equal(result.layer, "timeout");
  });

  it("503 → upstream", () => {
    const result = attributeFailure({ status_code: 503 });
    assert.equal(result.layer, "upstream");
    assert.equal(result.label, "Provider service error");
    assert.equal(result.retryable, true);
  });

  it("500 with body details → upstream (replaces old legacy 'Provider payment error' regex)", () => {
    const result = attributeFailure({
      status_code: 500,
      body: {
        error: "Failed to create payment intent",
        details: "amount is below provider minimum",
      },
    });
    assert.equal(result.layer, "upstream");
    assert.equal(result.label, "Provider service error");
  });

  it("400 → upstream (provider rejected request, not retryable)", () => {
    const result = attributeFailure({ status_code: 400 });
    assert.equal(result.layer, "upstream");
    assert.equal(result.label, "Provider rejected request");
    assert.equal(result.retryable, false);
  });
});

describe("attributeFailure — transport-level failures", () => {
  it("network error with no status code → transport", () => {
    const result = attributeFailure({ error: "ECONNREFUSED" });
    assert.equal(result.layer, "transport");
    assert.equal(result.label, "Network unreachable");
    assert.equal(result.retryable, true);
  });

  it("no status code + wallet payment_error → router_payment", () => {
    const result = attributeFailure({
      payment_error: "wallet private key missing",
    });
    assert.equal(result.layer, "router_payment");
  });
});

describe("agentRequestLabel — agent-facing short labels", () => {
  it("collapses payment-shaped layers to 'Payment required'", () => {
    assert.equal(
      agentRequestLabel({ layer: "facilitator", label: "x", retryable: true }),
      "Payment required",
    );
    assert.equal(
      agentRequestLabel({ layer: "router_payment", label: "x", retryable: false }),
      "Payment required",
    );
    assert.equal(
      agentRequestLabel({ layer: "agentkit", label: "x", retryable: true }),
      "Payment required",
    );
  });

  it("maps non-payment layers to their short labels", () => {
    assert.equal(
      agentRequestLabel({ layer: "rate_limit", label: "x", retryable: true }),
      "Rate limited",
    );
    assert.equal(
      agentRequestLabel({ layer: "timeout", label: "x", retryable: true }),
      "Request timed out",
    );
    assert.equal(
      agentRequestLabel({ layer: "upstream", label: "x", retryable: false }),
      "Provider error",
    );
    assert.equal(
      agentRequestLabel({ layer: "transport", label: "x", retryable: true }),
      "Network error",
    );
  });

  it("returns null for no attribution", () => {
    assert.equal(agentRequestLabel(null), null);
  });
});
