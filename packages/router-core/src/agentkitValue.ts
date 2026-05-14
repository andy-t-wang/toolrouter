const AGENTKIT_EVIDENCE_PATHS = new Set(["agentkit", "agentkit_to_x402"]);

function normalizedPath(row: any) {
  return String(row?.path || "").toLowerCase();
}

function isSuccessfulRow(row: any) {
  if (row?.ok === false) return false;
  const statusCode = Number(row?.status_code);
  if (Number.isFinite(statusCode) && statusCode >= 400) return false;
  if (row?.status && !["healthy", "degraded"].includes(String(row.status))) {
    return false;
  }
  return true;
}

export function countsAsAgentKitEvidence(endpoint: any, row: any) {
  if (!isSuccessfulRow(row)) return false;
  const path = normalizedPath(row);
  if (endpoint?.agentkit_value_type === "free_trial") {
    return path === "agentkit" && !row?.charged;
  }
  return AGENTKIT_EVIDENCE_PATHS.has(path);
}

export function realizedAgentKitValue(endpoint: any, row: any) {
  const type = endpoint?.agentkit_value_type || null;
  const label = endpoint?.agentkit_value_label || null;
  if (!type || !label || !countsAsAgentKitEvidence(endpoint, row)) {
    return { agentkit_value_type: null, agentkit_value_label: null };
  }
  return {
    agentkit_value_type: type,
    agentkit_value_label: label,
  };
}
