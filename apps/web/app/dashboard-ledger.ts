const USD_SCALE = 1_000_000n;

type LedgerEntry = {
  id?: string;
  ts?: string;
  type?: string;
  source?: string;
  reference_id?: string | null;
  amount_usd?: string | number | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type LedgerDisplayEntry = LedgerEntry & {
  amount_direction?: "positive" | "negative" | "neutral";
};

const LEDGER_TYPE_LABELS: Record<string, string> = {
  top_up_pending: "Top-up pending",
  top_up_settled: "Credits added",
  top_up_failed: "Top-up failed",
};

function parseUsd(value: unknown) {
  if (value === null || value === undefined || value === "") return 0n;
  const normalized = String(value).trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{0,6})\d*)?$/u);
  if (!match) return 0n;
  const [, sign, whole, fraction = ""] = match;
  const atomic = BigInt(whole) * USD_SCALE + BigInt((fraction + "000000").slice(0, 6));
  return sign === "-" ? -atomic : atomic;
}

function shouldCollapseRequestEntry(entry: LedgerEntry) {
  return (
    String(entry.source || "").toLowerCase() === "request" &&
    Boolean(entry.reference_id) &&
    ["reserve", "capture", "release"].includes(String(entry.type || ""))
  );
}

export function compactLedgerEntries(entries: LedgerEntry[] = []): LedgerDisplayEntry[] {
  const passthrough: LedgerDisplayEntry[] = [];

  for (const entry of entries) {
    if (shouldCollapseRequestEntry(entry)) continue;
    passthrough.push(entry);
  }

  return passthrough.sort((a, b) => Date.parse(b.ts || "") - Date.parse(a.ts || ""));
}

export function ledgerTypeLabel(type: unknown) {
  const normalized = String(type || "").trim();
  if (!normalized) return "-";
  if (LEDGER_TYPE_LABELS[normalized]) return LEDGER_TYPE_LABELS[normalized];
  return normalized
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function ledgerAmountPolarity(entry: LedgerDisplayEntry) {
  if (entry.amount_direction) return entry.amount_direction;
  const type = String(entry.type || "");
  if (type === "top_up_settled") return "positive";
  if (parseUsd(entry.amount_usd) > 0n && type === "adjustment") return "positive";
  if (parseUsd(entry.amount_usd) < 0n) return "negative";
  return "neutral";
}

export function ledgerAmountSign(entry: LedgerDisplayEntry) {
  const polarity = ledgerAmountPolarity(entry);
  if (polarity === "positive") return "+";
  if (polarity === "negative") return "-";
  return "";
}
