import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { computeDashboardMetrics, normalizedPaymentPath, paidAmount } = await import("../../../apps/web/app/dashboard-metrics.ts");

describe("dashboard metric normalization", () => {
  it("counts AgentKit fallback as paid x402 in the path split", () => {
    const metrics = computeDashboardMetrics(
      [
        { path: "agentkit", credit_captured_usd: "0" },
        { path: "agentkit_to_x402", credit_captured_usd: "0.007" },
        { path: "x402", credit_captured_usd: "0.006" },
        { path: "dev_stub", credit_captured_usd: "0" },
      ],
      new Date("2026-05-05T12:00:00Z"),
    );

    assert.equal(metrics.totalRequests, 4);
    assert.equal(metrics.agentKitCount, 1);
    assert.equal(metrics.x402Count, 2);
    assert.equal(metrics.trackedPathCount, 3);
    assert.ok(Math.abs(metrics.agentKitShare - 100 / 3) < 0.000001);
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
