import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { computeDashboardMetrics, normalizedPaymentPath, paidAmount } = await import("../../../apps/web/app/dashboard-metrics.ts");

describe("dashboard metric normalization", () => {
  it("counts successful AgentKit requests against all successful requests", () => {
    const metrics = computeDashboardMetrics(
      [
        { path: "agentkit", credit_captured_usd: "0", status_code: 200 },
        { path: "agentkit", credit_captured_usd: "0", status_code: 500, ok: false },
        { path: "agentkit_to_x402", credit_captured_usd: "0.007", status_code: 200 },
        { path: "x402", credit_captured_usd: "0.006", status_code: 200 },
        { path: "dev_stub", credit_captured_usd: "0", status_code: 200 },
      ],
      new Date("2026-05-05T12:00:00Z"),
    );

    assert.equal(metrics.totalRequests, 5);
    assert.equal(metrics.successfulRequestCount, 4);
    assert.equal(metrics.agentKitCount, 1);
    assert.equal(metrics.x402Count, 2);
    assert.equal(metrics.trackedPathCount, 3);
    assert.equal(metrics.agentKitShare, 25);
    assert.equal(metrics.agentKitPercent, 25);
    assert.equal(metrics.totalPaid, 0.013000000000000001);
  });

  it("prefers captured credits over provider amount when present", () => {
    assert.equal(paidAmount({ amount_usd: "0.008", credit_captured_usd: "0" }), 0);
    assert.equal(paidAmount({ amount_usd: "0.008", credit_captured_usd: "0.006" }), 0.006);
    assert.equal(paidAmount({ amount_usd: "0.008", credit_captured_usd: null }), 0.008);
  });

  it("normalizes only known paid/free execution paths", () => {
    assert.equal(normalizedPaymentPath("agentkit"), "agentkit");
    assert.equal(normalizedPaymentPath("x402"), "x402");
    assert.equal(normalizedPaymentPath("agentkit_to_x402"), "x402");
    assert.equal(normalizedPaymentPath("dev_stub"), "unknown");
  });
});
