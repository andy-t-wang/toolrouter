// Attribution-first failure classifier.
//
// Replaces the old `safeHealthError` / `safePaymentError` / `publicStatusError`
// triad. Both the router-core health worker and the apps/api gateway import the
// same `attributeFailure(...)` so labels can never diverge again.
//
// Background: on 2026-05-19 the health worker classified seller-side facilitator
// settlement failures from Exa and Browserbase as the generic "Provider payment
// required" because every 402 was collapsed to one label. Operators could not
// tell from `/v1/status` whether the failing layer was the seller, the
// facilitator, our wallet, or the upstream provider. `attributeFailure` reads
// the response body and `payment_error` field to name the failing layer.

export type FailureLayer =
  | "facilitator"
  | "router_payment"
  | "agentkit"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "upstream";

export interface Attribution {
  layer: FailureLayer;
  label: string;
  retryable: boolean;
}

interface AttributionInput {
  status_code?: number | string | null;
  statusCode?: number | string | null;
  error?: string | null;
  payment_error?: string | null;
  paymentError?: string | null;
  body?: unknown;
  ok?: boolean;
}

const SETTLEMENT_FAILURE_PATTERNS = [
  /settlement failed/i,
  /failed to settle payment/i,
  /settle.*failed/i,
];

const ROUTER_PAYMENT_PATTERNS = [
  /wallet/i,
  /signer/i,
  /signature/i,
  /credentials/i,
  /insufficient.*funds/i,
  /private key/i,
  /crossmint/i,
  /authorization.*invalid/i,
];

const TIMEOUT_PATTERNS = [/timed out/i, /timeout/i];

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bodyText(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["error", "message", "details", "errorReason", "errorMessage"]) {
    const v = obj[key];
    if (typeof v === "string") parts.push(v);
  }
  return parts.join(" ");
}

function isCleanX402Challenge(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  const accepts = obj.accepts;
  if (!Array.isArray(accepts)) return false;
  const hasVersion =
    typeof obj.x402Version === "number" || typeof obj.x402Version === "string";
  // A clean challenge has accepts[] and a version marker, and crucially has NOT
  // surfaced a settlement failure marker.
  if (!hasVersion) return false;
  const text = bodyText(body);
  for (const pattern of SETTLEMENT_FAILURE_PATTERNS) if (pattern.test(text)) return false;
  return true;
}

function anyMatch(haystack: string, patterns: RegExp[]): boolean {
  if (!haystack) return false;
  for (const pattern of patterns) if (pattern.test(haystack)) return true;
  return false;
}

/**
 * Classify a failed executor or HTTP result by the layer that caused the
 * failure. Returns `null` for success (HTTP 2xx) or a clean unresolved x402
 * challenge envelope (protocol working, not a failure).
 *
 * The decision matrix is the authoritative spec — see the High-Level Technical
 * Design table in `docs/plans/2026-05-19-001-refactor-modularity-and-reliability-plan.md`.
 */
export function attributeFailure(input: AttributionInput | null | undefined): Attribution | null {
  if (!input) return null;
  const statusCode = toNumber(input.status_code ?? input.statusCode);
  const errorText = String(input.error ?? "");
  const paymentError = String(input.payment_error ?? input.paymentError ?? "");
  const body = input.body;
  const bodyMessage = bodyText(body);
  const combined = `${errorText} ${paymentError} ${bodyMessage}`.trim();

  // Successful HTTP response — not a failure.
  if (statusCode !== null && statusCode >= 200 && statusCode < 400 && !combined) {
    return null;
  }
  if (input.ok === true && !combined) return null;

  if (statusCode === 402) {
    if (anyMatch(bodyMessage, SETTLEMENT_FAILURE_PATTERNS)) {
      return {
        layer: "facilitator",
        label: "Settlement failed at facilitator",
        retryable: true,
      };
    }
    if (paymentError && anyMatch(paymentError, ROUTER_PAYMENT_PATTERNS)) {
      return {
        layer: "router_payment",
        label: "Router wallet signing failed",
        retryable: false,
      };
    }
    if (isCleanX402Challenge(body)) {
      // Protocol working — challenge envelope, no failure to attribute.
      return null;
    }
    // Fallback: an opaque 402 with no clear marker. Treat as router_payment
    // when payment_error is set, otherwise as agentkit (challenge active).
    if (paymentError) {
      return {
        layer: "router_payment",
        label: "Router payment failed",
        retryable: false,
      };
    }
    return {
      layer: "agentkit",
      label: "AgentKit challenge active",
      retryable: true,
    };
  }

  if (statusCode === 429) {
    return { layer: "rate_limit", label: "Provider rate limited", retryable: true };
  }
  if (statusCode === 504 || anyMatch(combined, TIMEOUT_PATTERNS)) {
    return { layer: "timeout", label: "Provider timed out", retryable: true };
  }
  if (statusCode !== null && statusCode >= 500) {
    return { layer: "upstream", label: "Provider service error", retryable: true };
  }
  if (statusCode !== null && statusCode >= 400) {
    return { layer: "upstream", label: "Provider rejected request", retryable: false };
  }

  // No status code: network / DNS / transport-level failure.
  if (combined) {
    if (anyMatch(combined, TIMEOUT_PATTERNS)) {
      return { layer: "timeout", label: "Provider timed out", retryable: true };
    }
    if (paymentError && anyMatch(paymentError, ROUTER_PAYMENT_PATTERNS)) {
      return {
        layer: "router_payment",
        label: "Router wallet signing failed",
        retryable: false,
      };
    }
    return { layer: "transport", label: "Network unreachable", retryable: true };
  }

  return null;
}

/**
 * Short, agent-facing label for `/v1/requests/:id` responses. Distinct from the
 * operator-facing `attribution.label` because agents see shorter, more direct
 * error strings.
 */
export function agentRequestLabel(attribution: Attribution | null): string | null {
  if (!attribution) return null;
  switch (attribution.layer) {
    case "facilitator":
    case "router_payment":
    case "agentkit":
      return "Payment required";
    case "rate_limit":
      return "Rate limited";
    case "timeout":
      return "Request timed out";
    case "upstream":
      return "Provider error";
    case "transport":
      return "Network error";
    default:
      return "Request failed";
  }
}
