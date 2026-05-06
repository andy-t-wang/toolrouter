import { randomUUID } from "node:crypto";

const USD_SCALE = 1_000_000n;

export type CreditReservation = {
  id: string;
  user_id: string;
  api_key_id?: string | null;
  request_id?: string | null;
  trace_id?: string | null;
  endpoint_id?: string | null;
  amount_usd: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function parseUsd(value: unknown, label = "USD amount") {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw Object.assign(new Error(`${label} must be a positive decimal with up to 6 places`), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * USD_SCALE + BigInt((fraction + "000000").slice(0, 6));
}

export function formatUsd(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / USD_SCALE;
  const fraction = String(absolute % USD_SCALE).padStart(6, "0").replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function accountBigints(account: any) {
  return {
    available: parseUsd(account?.available_usd ?? "0", "available_usd"),
    pending: parseUsd(account?.pending_usd ?? "0", "pending_usd"),
    reserved: parseUsd(account?.reserved_usd ?? "0", "reserved_usd"),
  };
}

function ledgerBase({ user_id, type, amount_usd, source, reference_id, metadata = {} }: any) {
  return {
    id: `cle_${randomUUID()}`,
    ts: nowIso(),
    user_id,
    type,
    amount_usd,
    currency: "USD",
    source,
    reference_id: reference_id || null,
    metadata,
  };
}

export async function ensureCreditAccount(store: any, user_id: string) {
  const existing = await store.getCreditAccount({ user_id });
  if (existing) return existing;
  const devBalance = process.env.ROUTER_DEV_MODE === "true" ? process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD || "100" : "0";
  return store.upsertCreditAccount({
    user_id,
    available_usd: devBalance,
    pending_usd: "0",
    reserved_usd: "0",
    currency: "USD",
    updated_at: nowIso(),
  });
}

export async function getCreditBalance(store: any, user_id: string) {
  return ensureCreditAccount(store, user_id);
}

export function assertTopUpAmount(amountUsd: unknown) {
  const amount = parseUsd(amountUsd, "amountUsd");
  if (amount <= 0n) {
    throw Object.assign(new Error("amountUsd must be greater than zero"), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }
  const max = parseUsd(process.env.TOOLROUTER_MAX_TOP_UP_USD || "500", "TOOLROUTER_MAX_TOP_UP_USD");
  if (amount > max) {
    throw Object.assign(new Error(`amountUsd exceeds configured top-up cap of ${formatUsd(max)}`), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }
  return formatUsd(amount);
}

export async function reserveCredits({
  store,
  user_id,
  api_key_id,
  trace_id,
  endpoint_id,
  amountUsd,
}: {
  store: any;
  user_id: string;
  api_key_id?: string;
  trace_id?: string;
  endpoint_id?: string;
  amountUsd: string;
}): Promise<CreditReservation> {
  const amount = parseUsd(amountUsd, "maxUsd");
  if (amount <= 0n) {
    throw Object.assign(new Error("maxUsd must be greater than zero"), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }

  const account = await ensureCreditAccount(store, user_id);
  const balances = accountBigints(account);
  if (balances.available < amount) {
    throw Object.assign(new Error("insufficient ToolRouter credits"), {
      statusCode: 402,
      code: "insufficient_credits",
      details: {
        available_usd: formatUsd(balances.available),
        required_usd: formatUsd(amount),
      },
    });
  }

  const reservation: CreditReservation = {
    id: `crr_${randomUUID()}`,
    user_id,
    api_key_id: api_key_id || null,
    trace_id: trace_id || null,
    endpoint_id: endpoint_id || null,
    amount_usd: formatUsd(amount),
  };

  await store.upsertCreditAccount({
    ...account,
    available_usd: formatUsd(balances.available - amount),
    reserved_usd: formatUsd(balances.reserved + amount),
    updated_at: nowIso(),
  });
  await store.insertCreditLedgerEntry(
    ledgerBase({
      user_id,
      type: "reserve",
      amount_usd: reservation.amount_usd,
      source: "request",
      reference_id: reservation.id,
      metadata: {
        api_key_id,
        trace_id,
        endpoint_id,
      },
    }),
  );

  return reservation;
}

export async function finalizeCreditReservation({
  store,
  reservation,
  amountUsd,
  paymentReference,
  metadata = {},
}: {
  store: any;
  reservation: CreditReservation;
  amountUsd?: string | number | null;
  paymentReference?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const reserved = parseUsd(reservation.amount_usd, "reserved amount");
  const requestedCapture = amountUsd === undefined || amountUsd === null || amountUsd === "" ? 0n : parseUsd(amountUsd, "captured amount");
  const captured = requestedCapture > reserved ? reserved : requestedCapture;
  const released = reserved - captured;
  const account = await ensureCreditAccount(store, reservation.user_id);
  const balances = accountBigints(account);

  await store.upsertCreditAccount({
    ...account,
    available_usd: formatUsd(balances.available + released),
    reserved_usd: formatUsd(balances.reserved > reserved ? balances.reserved - reserved : 0n),
    updated_at: nowIso(),
  });

  if (captured > 0n) {
    await store.insertCreditLedgerEntry(
      ledgerBase({
        user_id: reservation.user_id,
        type: "capture",
        amount_usd: formatUsd(captured),
        source: "request",
        reference_id: reservation.id,
        metadata: {
          ...metadata,
          payment_reference: paymentReference || null,
          trace_id: reservation.trace_id,
          endpoint_id: reservation.endpoint_id,
        },
      }),
    );
  }
  if (released > 0n) {
    await store.insertCreditLedgerEntry(
      ledgerBase({
        user_id: reservation.user_id,
        type: "release",
        amount_usd: formatUsd(released),
        source: "request",
        reference_id: reservation.id,
        metadata: {
          ...metadata,
          trace_id: reservation.trace_id,
          endpoint_id: reservation.endpoint_id,
        },
      }),
    );
  }

  return {
    credit_reservation_id: reservation.id,
    credit_reserved_usd: reservation.amount_usd,
    credit_captured_usd: formatUsd(captured),
    credit_released_usd: formatUsd(released),
  };
}

export async function releaseCreditReservation({
  store,
  reservation,
  reason,
}: {
  store: any;
  reservation: CreditReservation;
  reason?: string;
}) {
  return finalizeCreditReservation({
    store,
    reservation,
    amountUsd: "0",
    metadata: { reason: reason || "request_failed" },
  });
}

export async function markTopUpPending({
  store,
  user_id,
  wallet_account_id,
  provider_reference,
  amountUsd,
  metadata,
}: {
  store: any;
  user_id: string;
  wallet_account_id?: string | null;
  provider_reference: string;
  amountUsd: string;
  metadata?: Record<string, unknown>;
}) {
  const amount = parseUsd(amountUsd, "amountUsd");
  const account = await ensureCreditAccount(store, user_id);
  const balances = accountBigints(account);
  const transaction = await store.insertWalletTransaction({
    id: `wtx_${randomUUID()}`,
    ts: nowIso(),
    user_id,
    wallet_account_id: wallet_account_id || null,
    provider: "crossmint",
    provider_reference,
    kind: "top_up",
    status: "pending",
    amount_usd: formatUsd(amount),
    currency: "USD",
    chain_id: "eip155:8453",
    asset: "USDC",
    metadata: metadata || {},
  });

  await store.upsertCreditAccount({
    ...account,
    pending_usd: formatUsd(balances.pending + amount),
    updated_at: nowIso(),
  });
  await store.insertCreditLedgerEntry(
    ledgerBase({
      user_id,
      type: "top_up_pending",
      amount_usd: formatUsd(amount),
      source: "crossmint",
      reference_id: provider_reference,
      metadata: metadata || {},
    }),
  );

  return transaction;
}

export async function settleTopUp({
  store,
  provider_reference,
  status,
  metadata,
}: {
  store: any;
  provider_reference: string;
  status: "success" | "failed";
  metadata?: Record<string, unknown>;
}) {
  const transaction = await store.findWalletTransactionByProviderReference(provider_reference);
  if (!transaction) {
    throw Object.assign(new Error("wallet transaction not found"), {
      statusCode: 404,
      code: "not_found",
    });
  }
  if (transaction.status === "success" || transaction.status === "failed") {
    return { transaction, duplicate: true };
  }

  const amount = parseUsd(transaction.amount_usd, "top-up amount");
  const account = await ensureCreditAccount(store, transaction.user_id);
  const balances = accountBigints(account);
  const nextPending = balances.pending > amount ? balances.pending - amount : 0n;
  const nextAvailable = status === "success" ? balances.available + amount : balances.available;

  const updated = await store.updateWalletTransaction({
    ...transaction,
    status,
    metadata: {
      ...(transaction.metadata || {}),
      ...(metadata || {}),
    },
  });
  await store.upsertCreditAccount({
    ...account,
    available_usd: formatUsd(nextAvailable),
    pending_usd: formatUsd(nextPending),
    updated_at: nowIso(),
  });
  await store.insertCreditLedgerEntry(
    ledgerBase({
      user_id: transaction.user_id,
      type: status === "success" ? "top_up_settled" : "top_up_failed",
      amount_usd: transaction.amount_usd,
      source: "crossmint",
      reference_id: provider_reference,
      metadata: metadata || {},
    }),
  );

  return { transaction: updated, duplicate: false };
}
