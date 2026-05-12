export type DashboardRequestRow = {
  amount_usd?: unknown;
  charged?: unknown;
  credit_captured_usd?: unknown;
  error?: unknown;
  ok?: unknown;
  path?: unknown;
  status_code?: unknown;
};

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function paidAmount(row: DashboardRequestRow) {
  if (row.credit_captured_usd !== null && row.credit_captured_usd !== undefined && row.credit_captured_usd !== "") {
    return toNumber(row.credit_captured_usd);
  }
  return toNumber(row.amount_usd);
}

export function normalizedPaymentPath(path: unknown) {
  const route = String(path || "").toLowerCase();
  if (route === "agentkit") return "agentkit";
  if (route === "x402" || route === "agentkit_to_x402") return "x402";
  return "unknown";
}

export function requestSucceeded(row: DashboardRequestRow) {
  const statusCode = Number(row.status_code);
  if (row.error || row.ok === false) return false;
  return !Number.isFinite(statusCode) || statusCode < 400;
}

export function computeDashboardMetrics(rows: DashboardRequestRow[], now = new Date()) {
  const totalRequests = rows.length;
  const successfulRows = rows.filter(requestSucceeded);
  const agentKitCount = successfulRows.filter((row) => normalizedPaymentPath(row.path) === "agentkit").length;
  const x402Count = successfulRows.filter((row) => normalizedPaymentPath(row.path) === "x402").length;
  const totalPaid = rows.reduce((sum, row) => sum + paidAmount(row), 0);
  const successfulRequestCount = successfulRows.length;
  const agentKitPercent = successfulRequestCount ? (agentKitCount / successfulRequestCount) * 100 : 0;
  const agentKitShare = successfulRequestCount ? (agentKitCount / successfulRequestCount) * 100 : 0;
  const dayOfMonth = Math.max(1, now.getDate());
  return {
    agentKitCount,
    agentKitPercent,
    agentKitShare,
    avgPerDay: totalRequests ? Math.max(1, Math.round(totalRequests / dayOfMonth)) : 0,
    avgPaidPerRequest: totalRequests ? totalPaid / totalRequests : 0,
    trackedPathCount: agentKitCount + x402Count,
    totalPaid,
    totalRequests,
    successfulRequestCount,
    x402Count,
  };
}
