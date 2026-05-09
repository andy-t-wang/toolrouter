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
  request_charge: "Usage charged",
  request_started: "Usage started",
  reserve: "Usage started",
  capture: "Usage charged",
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

function formatUsd(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / USD_SCALE;
  const fraction = String(absolute % USD_SCALE).padStart(6, "0").replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function byTimestamp(a: LedgerEntry, b: LedgerEntry) {
  return Date.parse(a.ts || "") - Date.parse(b.ts || "");
}

function latestMeaningfulEntry(entries: LedgerEntry[]) {
  const ordered = [...entries].sort(byTimestamp);
  return (
    [...ordered].reverse().find((entry) => entry.type === "capture" || entry.type === "release") ||
    ordered[0] ||
    entries[0]
  );
}

function collapseRequestLedgerGroup(referenceId: string, entries: LedgerEntry[]): LedgerDisplayEntry | null {
  const captured = entries
    .filter((entry) => entry.type === "capture")
    .reduce((total, entry) => total + parseUsd(entry.amount_usd), 0n);
  const released = entries
    .filter((entry) => entry.type === "release")
    .reduce((total, entry) => total + parseUsd(entry.amount_usd), 0n);
  if (captured === 0n && released > 0n) return null;

  const reserve = entries.find((entry) => entry.type === "reserve") || entries[0];
  const display = latestMeaningfulEntry(entries);
  const amount = captured > 0n ? captured : parseUsd(reserve?.amount_usd);
  const type = captured > 0n ? "request_charge" : "request_started";
  const direction: LedgerDisplayEntry["amount_direction"] =
    captured > 0n ? "negative" : "neutral";

  return {
    ...display,
    id: `request:${referenceId}`,
    type,
    source: "request",
    reference_id: referenceId,
    amount_usd: formatUsd(amount),
    amount_direction: direction,
    metadata: {
      ...(reserve?.metadata || {}),
      ...(display?.metadata || {}),
      collapsed_ledger_entry_count: entries.length,
    },
  };
}

function shouldCollapseRequestEntry(entry: LedgerEntry) {
  return (
    String(entry.source || "").toLowerCase() === "request" &&
    Boolean(entry.reference_id) &&
    ["reserve", "capture", "release"].includes(String(entry.type || ""))
  );
}

export function compactLedgerEntries(entries: LedgerEntry[] = []): LedgerDisplayEntry[] {
  const grouped = new Map<string, LedgerEntry[]>();
  const passthrough: LedgerDisplayEntry[] = [];

  for (const entry of entries) {
    if (!shouldCollapseRequestEntry(entry)) {
      passthrough.push(entry);
      continue;
    }
    const referenceId = String(entry.reference_id);
    grouped.set(referenceId, [...(grouped.get(referenceId) || []), entry]);
  }

  const collapsed = [...grouped.entries()]
    .map(([referenceId, group]) => collapseRequestLedgerGroup(referenceId, group))
    .filter((entry): entry is LedgerDisplayEntry => Boolean(entry));
  return [...passthrough, ...collapsed].sort((a, b) => Date.parse(b.ts || "") - Date.parse(a.ts || ""));
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
  if (type === "capture") return "negative";
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
