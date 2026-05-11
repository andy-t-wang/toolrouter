import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { DEFAULT_DEV_USER_ID, createApiKey, hashApiKey } from "@toolrouter/auth";

const DEFAULT_PATH = resolve(process.cwd(), ".agentkit-router/local-store.json");

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(path: string, fallback: any) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: any) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function initialData() {
  return {
    api_keys: [],
    requests: [],
    endpoint_status: [],
    health_checks: [],
    wallet_accounts: [],
    credit_accounts: [],
    credit_ledger_entries: [],
    credit_purchases: [],
    wallet_transactions: [],
  };
}

function qs(params: Record<string, any>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

function ensureDevKey(data: any) {
  if (process.env.ROUTER_DEV_MODE !== "true") return null;
  const rawKey = process.env.AGENTKIT_ROUTER_DEV_API_KEY || "dev_agentkit_router_key";
  const userId = process.env.TOOLROUTER_DEV_USER_ID || DEFAULT_DEV_USER_ID;
  const keyHash = hashApiKey(rawKey);
  let record = data.api_keys.find((item: any) => item.key_hash === keyHash);
  if (!record) {
    record = {
      id: "key_dev",
      user_id: userId,
      caller_id: "hermes-dev",
      key_hash: keyHash,
      created_at: new Date().toISOString(),
      disabled_at: null,
    };
    data.api_keys.push(record);
  } else if (record.user_id === "dev-user") {
    record.user_id = userId;
  }
  return { rawKey, record };
}

function matchesFilters(row: any, filters: any) {
  if (filters.endpoint_id && row.endpoint_id !== filters.endpoint_id) return false;
  if (filters.api_key_id && row.api_key_id !== filters.api_key_id) return false;
  if (filters.user_id && row.user_id !== filters.user_id) return false;
  if (filters.status && String(row.status_code) !== String(filters.status)) return false;
  if (filters.charged !== undefined && String(Boolean(row.charged)) !== String(filters.charged)) return false;
  if (filters.since && Date.parse(row.ts) < Date.parse(filters.since)) return false;
  if (filters.before_ts && filters.before_id) {
    const rowTs = String(row.ts || "");
    const beforeTs = String(filters.before_ts);
    if (rowTs > beforeTs) return false;
    if (rowTs === beforeTs && String(row.id || "") >= String(filters.before_id)) return false;
  }
  return true;
}

export class LocalStore {
  path: string;

  constructor({ path = process.env.AGENTKIT_ROUTER_LOCAL_STORE || DEFAULT_PATH } = {}) {
    this.path = path;
  }

  read() {
    const data = readJson(this.path, initialData());
    data.api_keys ||= [];
    data.requests ||= [];
    data.endpoint_status ||= [];
    data.health_checks ||= [];
    data.wallet_accounts ||= [];
    data.credit_accounts ||= [];
    data.credit_ledger_entries ||= [];
    data.credit_purchases ||= [];
    data.wallet_transactions ||= [];
    ensureDevKey(data);
    writeJson(this.path, data);
    return data;
  }

  write(data: any) {
    writeJson(this.path, data);
  }

  async findApiKeyByHash(keyHash: string) {
    return this.read().api_keys.find((key: any) => key.key_hash === keyHash) || null;
  }

  async createApiKey({ user_id = "local-user", caller_id }: { user_id?: string; caller_id: string }) {
    const data = this.read();
    const activeDuplicate = data.api_keys.find(
      (key: any) => key.user_id === user_id && key.caller_id === caller_id && !key.disabled_at,
    );
    if (activeDuplicate) {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "api_keys_user_caller_active_key"'),
        {
          statusCode: 409,
          code: "local_store_conflict",
          details: `Key (user_id, caller_id)=(${user_id}, ${caller_id}) already exists.`,
        },
      );
    }
    const rawKey = createApiKey();
    const record = {
      id: `key_${randomUUID()}`,
      user_id,
      caller_id,
      key_hash: hashApiKey(rawKey),
      created_at: new Date().toISOString(),
      disabled_at: null,
    };
    data.api_keys.push(record);
    this.write(data);
    const { key_hash, ...safe } = record;
    return { api_key: rawKey, record: safe };
  }

  async listApiKeys({ user_id }: { user_id?: string } = {}) {
    return this.read().api_keys
      .filter((key: any) => !user_id || key.user_id === user_id)
      .map(({ key_hash, ...key }: any) => key);
  }

  async disableApiKey({ id, user_id }: { id: string; user_id?: string }) {
    const data = this.read();
    const key = data.api_keys.find((item: any) => item.id === id && (!user_id || item.user_id === user_id));
    if (!key) return null;
    key.disabled_at = new Date().toISOString();
    this.write(data);
    const { key_hash, ...safe } = key;
    return safe;
  }

  async insertRequest(row: any) {
    const data = this.read();
    data.requests.unshift(row);
    data.requests = data.requests.slice(0, 10000);
    this.write(data);
    return row;
  }

  async listRequests(filters: any = {}) {
    const limit = Math.max(1, Math.min(Number(filters.limit || 100), 501));
    return this.read().requests
      .filter((row: any) => matchesFilters(row, filters))
      .sort((a: any, b: any) => {
        const ts = String(b.ts || "").localeCompare(String(a.ts || ""));
        if (ts !== 0) return ts;
        return String(b.id || "").localeCompare(String(a.id || ""));
      })
      .slice(0, limit);
  }

  async getRequest(id: string) {
    return this.read().requests.find((row: any) => row.id === id) || null;
  }

  async listEndpointStatus() {
    return this.read().endpoint_status;
  }

  async listHealthChecks(filters: any = {}) {
    const limit = Math.max(1, Math.min(Number(filters.limit || 1000), 5000));
    return this.read().health_checks
      .filter((row: any) => {
        if (filters.endpoint_id && row.endpoint_id !== filters.endpoint_id) return false;
        if (filters.since && Date.parse(row.checked_at) < Date.parse(filters.since)) return false;
        return true;
      })
      .sort((a: any, b: any) => Date.parse(b.checked_at) - Date.parse(a.checked_at))
      .slice(0, limit);
  }

  async insertHealthCheck(row: any) {
    const data = this.read();
    data.health_checks.unshift(row);
    data.health_checks = data.health_checks.slice(0, 5000);
    this.write(data);
    return row;
  }

  async upsertEndpointStatus(row: any) {
    const data = this.read();
    const index = data.endpoint_status.findIndex((item: any) => item.endpoint_id === row.endpoint_id);
    if (index >= 0) data.endpoint_status[index] = row;
    else data.endpoint_status.push(row);
    this.write(data);
    return row;
  }

  async getWalletAccount({ user_id }: { user_id: string }) {
    return this.read().wallet_accounts.find((row: any) => row.user_id === user_id) || null;
  }

  async upsertWalletAccount(row: any) {
    const data = this.read();
    const index = data.wallet_accounts.findIndex((item: any) => item.user_id === row.user_id);
    const next = { ...row, updated_at: new Date().toISOString() };
    if (index >= 0) data.wallet_accounts[index] = { ...data.wallet_accounts[index], ...next };
    else data.wallet_accounts.push({ id: row.id || `wa_${randomUUID()}`, created_at: new Date().toISOString(), ...next });
    this.write(data);
    return data.wallet_accounts.find((item: any) => item.user_id === row.user_id);
  }

  async getCreditAccount({ user_id }: { user_id: string }) {
    return this.read().credit_accounts.find((row: any) => row.user_id === user_id) || null;
  }

  async upsertCreditAccount(row: any) {
    const data = this.read();
    const index = data.credit_accounts.findIndex((item: any) => item.user_id === row.user_id);
    const next = { ...row, updated_at: row.updated_at || new Date().toISOString() };
    if (index >= 0) data.credit_accounts[index] = { ...data.credit_accounts[index], ...next };
    else data.credit_accounts.push({ created_at: new Date().toISOString(), ...next });
    this.write(data);
    return data.credit_accounts.find((item: any) => item.user_id === row.user_id);
  }

  async insertCreditLedgerEntry(row: any) {
    const data = this.read();
    data.credit_ledger_entries.unshift(row);
    data.credit_ledger_entries = data.credit_ledger_entries.slice(0, 10000);
    this.write(data);
    return row;
  }

  async listCreditLedgerEntries({ user_id, limit = 100 }: { user_id: string; limit?: number }) {
    return this.read().credit_ledger_entries
      .filter((row: any) => row.user_id === user_id)
      .slice(0, Math.max(1, Math.min(Number(limit || 100), 500)));
  }

  async insertCreditPurchase(row: any) {
    const data = this.read();
    data.credit_purchases.unshift({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row });
    this.write(data);
    return data.credit_purchases.find((item: any) => item.id === row.id) || row;
  }

  async updateCreditPurchase(row: any) {
    const data = this.read();
    const index = data.credit_purchases.findIndex((item: any) => item.id === row.id);
    const next = { ...row, updated_at: new Date().toISOString() };
    if (index >= 0) data.credit_purchases[index] = { ...data.credit_purchases[index], ...next };
    else data.credit_purchases.unshift(next);
    this.write(data);
    return data.credit_purchases.find((item: any) => item.id === row.id) || next;
  }

  async getCreditPurchase(id: string) {
    return this.read().credit_purchases.find((row: any) => row.id === id) || null;
  }

  async findCreditPurchaseByProviderSession(provider_checkout_session_id: string) {
    return this.read().credit_purchases.find((row: any) => row.provider_checkout_session_id === provider_checkout_session_id) || null;
  }

  async listCreditPurchases({
    user_id,
    status,
    since,
    limit = 100,
  }: {
    user_id?: string;
    status?: string;
    since?: string;
    limit?: number;
  } = {}) {
    return this.read().credit_purchases
      .filter(
        (row: any) =>
          (!user_id || row.user_id === user_id) &&
          (!status || row.status === status) &&
          (!since || Date.parse(row.created_at) >= Date.parse(since)),
      )
      .slice(0, Math.max(1, Math.min(Number(limit || 100), 500)));
  }

  async claimCreditPurchaseForFunding({ id, provider_checkout_session_id }: { id?: string; provider_checkout_session_id?: string }) {
    const data = this.read();
    const purchase = data.credit_purchases.find(
      (row: any) =>
        (row.status === "checkout_pending" || row.status === "funding_failed") &&
        (!id || row.id === id) &&
        (!provider_checkout_session_id || row.provider_checkout_session_id === provider_checkout_session_id),
    );
    if (!purchase) return null;
    purchase.status = "funding_pending";
    purchase.updated_at = new Date().toISOString();
    this.write(data);
    return purchase;
  }

  async insertWalletTransaction(row: any) {
    const data = this.read();
    data.wallet_transactions.unshift(row);
    data.wallet_transactions = data.wallet_transactions.slice(0, 10000);
    this.write(data);
    return row;
  }

  async updateWalletTransaction(row: any) {
    const data = this.read();
    const index = data.wallet_transactions.findIndex((item: any) => item.id === row.id);
    const next = { ...row, updated_at: new Date().toISOString() };
    if (index >= 0) data.wallet_transactions[index] = { ...data.wallet_transactions[index], ...next };
    else data.wallet_transactions.unshift(next);
    this.write(data);
    return data.wallet_transactions.find((item: any) => item.id === row.id) || next;
  }

  async findWalletTransactionByProviderReference(provider_reference: string) {
    return this.read().wallet_transactions.find((row: any) => row.provider_reference === provider_reference) || null;
  }
}

export class SupabaseStore {
  url: string;
  serviceRoleKey: string;

  constructor({
    url = requireEnv("SUPABASE_URL"),
    serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  } = {}) {
    this.url = url.replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
  }

  async request(path: string, { method = "GET", body, prefer }: any = {}) {
    const response = await fetch(`${this.url}/rest/v1${path}`, {
      method,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        "content-type": "application/json",
        ...(prefer ? { prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw Object.assign(new Error(data?.message || `Supabase request failed: ${response.status}`), {
        statusCode: response.status,
        code: "supabase_error",
      });
    }
    return data;
  }

  async findApiKeyByHash(keyHash: string) {
    const query = qs({
      key_hash: `eq.${keyHash}`,
      disabled_at: "is.null",
      select: "id,user_id,caller_id,key_hash,disabled_at",
      limit: 1,
    });
    return (await this.request(`/api_keys?${query}`))?.[0] || null;
  }

  async createApiKey({ user_id, caller_id }: { user_id: string; caller_id: string }) {
    const rawKey = createApiKey();
    const record = {
      id: `key_${randomUUID()}`,
      user_id,
      caller_id,
      key_hash: hashApiKey(rawKey),
    };
    const created = (await this.request("/api_keys", {
      method: "POST",
      body: record,
      prefer: "return=representation",
    }))?.[0];
    const { key_hash, ...safe } = created || record;
    return { api_key: rawKey, record: safe };
  }

  async listApiKeys({ user_id }: { user_id?: string } = {}) {
    const params: any = {
      select: "id,user_id,caller_id,created_at,disabled_at",
      order: "created_at.desc",
    };
    if (user_id) params.user_id = `eq.${user_id}`;
    return this.request(`/api_keys?${qs(params)}`);
  }

  async disableApiKey({ id, user_id }: { id: string; user_id?: string }) {
    const params: any = { id: `eq.${id}`, select: "id,user_id,caller_id,created_at,disabled_at" };
    if (user_id) params.user_id = `eq.${user_id}`;
    return (await this.request(`/api_keys?${qs(params)}`, {
      method: "PATCH",
      body: { disabled_at: new Date().toISOString() },
      prefer: "return=representation",
    }))?.[0] || null;
  }

  async insertRequest(row: any) {
    return (await this.request("/requests", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async listRequests(filters: any = {}) {
    const params: any = {
      select: "*",
      order: "ts.desc,id.desc",
      limit: filters.limit || 100,
    };
    if (filters.endpoint_id) params.endpoint_id = `eq.${filters.endpoint_id}`;
    if (filters.api_key_id) params.api_key_id = `eq.${filters.api_key_id}`;
    if (filters.user_id) params.user_id = `eq.${filters.user_id}`;
    if (filters.status) params.status_code = `eq.${filters.status}`;
    if (filters.charged !== undefined) params.charged = `eq.${filters.charged}`;
    if (filters.since) params.ts = `gte.${filters.since}`;
    if (filters.before_ts && filters.before_id) {
      params.or = `(ts.lt.${filters.before_ts},and(ts.eq.${filters.before_ts},id.lt.${filters.before_id}))`;
    }
    return this.request(`/requests?${qs(params)}`);
  }

  async getRequest(id: string) {
    return (await this.request(`/requests?${qs({ id: `eq.${id}`, select: "*", limit: 1 })}`))?.[0] || null;
  }

  async listEndpointStatus() {
    return this.request(`/endpoint_status?${qs({ select: "*" })}`);
  }

  async listHealthChecks(filters: any = {}) {
    const params: any = {
      select: "*",
      order: "checked_at.desc",
      limit: filters.limit || 5000,
    };
    if (filters.endpoint_id) params.endpoint_id = `eq.${filters.endpoint_id}`;
    if (filters.since) params.checked_at = `gte.${filters.since}`;
    return this.request(`/health_checks?${qs(params)}`);
  }

  async insertHealthCheck(row: any) {
    return (await this.request("/health_checks", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async upsertEndpointStatus(row: any) {
    return (await this.request("/endpoint_status", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=representation",
    }))?.[0] || row;
  }

  async getWalletAccount({ user_id }: { user_id: string }) {
    return (await this.request(`/wallet_accounts?${qs({ user_id: `eq.${user_id}`, select: "*", limit: 1 })}`))?.[0] || null;
  }

  async upsertWalletAccount(row: any) {
    return (await this.request("/wallet_accounts?on_conflict=user_id", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=representation",
    }))?.[0] || row;
  }

  async getCreditAccount({ user_id }: { user_id: string }) {
    return (await this.request(`/credit_accounts?${qs({ user_id: `eq.${user_id}`, select: "*", limit: 1 })}`))?.[0] || null;
  }

  async upsertCreditAccount(row: any) {
    return (await this.request("/credit_accounts", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=representation",
    }))?.[0] || row;
  }

  async insertCreditLedgerEntry(row: any) {
    return (await this.request("/credit_ledger_entries", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async listCreditLedgerEntries({ user_id, limit = 100 }: { user_id: string; limit?: number }) {
    return this.request(
      `/credit_ledger_entries?${qs({
        user_id: `eq.${user_id}`,
        select: "*",
        order: "ts.desc",
        limit,
      })}`,
    );
  }

  async insertCreditPurchase(row: any) {
    return (await this.request("/credit_purchases", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async updateCreditPurchase(row: any) {
    return (await this.request(`/credit_purchases?${qs({ id: `eq.${row.id}`, select: "*" })}`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async getCreditPurchase(id: string) {
    return (await this.request(`/credit_purchases?${qs({ id: `eq.${id}`, select: "*", limit: 1 })}`))?.[0] || null;
  }

  async findCreditPurchaseByProviderSession(provider_checkout_session_id: string) {
    return (
      (await this.request(
        `/credit_purchases?${qs({
          provider_checkout_session_id: `eq.${provider_checkout_session_id}`,
          select: "*",
          limit: 1,
        })}`,
      ))?.[0] || null
    );
  }

  async claimCreditPurchaseForFunding({
    id,
    provider_checkout_session_id,
  }: {
    id?: string;
    provider_checkout_session_id?: string;
  }) {
    const params: any = {
      status: "in.(checkout_pending,funding_failed)",
      select: "*",
    };
    if (id) params.id = `eq.${id}`;
    if (provider_checkout_session_id) params.provider_checkout_session_id = `eq.${provider_checkout_session_id}`;
    return (await this.request(`/credit_purchases?${qs(params)}`, {
      method: "PATCH",
      body: {
        status: "funding_pending",
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
    }))?.[0] || null;
  }

  async listCreditPurchases({
    user_id,
    status,
    since,
    limit = 100,
  }: {
    user_id?: string;
    status?: string;
    since?: string;
    limit?: number;
  } = {}) {
    const params: any = {
      select: "*",
      order: "created_at.desc",
      limit,
    };
    if (user_id) params.user_id = `eq.${user_id}`;
    if (status) params.status = `eq.${status}`;
    if (since) params.created_at = `gte.${since}`;
    return this.request(`/credit_purchases?${qs(params)}`);
  }

  async insertWalletTransaction(row: any) {
    return (await this.request("/wallet_transactions", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async updateWalletTransaction(row: any) {
    return (await this.request(`/wallet_transactions?${qs({ id: `eq.${row.id}`, select: "*" })}`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    }))?.[0] || row;
  }

  async findWalletTransactionByProviderReference(provider_reference: string) {
    return (
      (await this.request(
        `/wallet_transactions?${qs({
          provider_reference: `eq.${provider_reference}`,
          select: "*",
          limit: 1,
        })}`,
      ))?.[0] || null
    );
  }
}

export function createStore() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStore();
  }
  return new LocalStore();
}
