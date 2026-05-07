import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type ApiKeyAuth = {
  api_key_id: string;
  user_id: string;
  caller_id: string;
};

export type UserSession = {
  user_id: string;
  email?: string | null;
};

export const DEFAULT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEV_SESSION_TOKEN = "dev_supabase_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let devSupabaseUserPromise: Promise<UserSession> | null = null;

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(String(apiKey)).digest("hex");
}

export function createApiKey({ prefix = "tr" } = {}) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function bearerToken(headers: Record<string, string | string[] | undefined>) {
  const raw = headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function authenticateApiKey(headers: Record<string, string | string[] | undefined>, store: any) {
  const token = bearerToken(headers);
  if (!token) {
    throw Object.assign(new Error("missing bearer API key"), {
      statusCode: 401,
      code: "unauthorized",
    });
  }

  const keyHash = hashApiKey(token);
  const record = await store.findApiKeyByHash(keyHash);
  if (!record || record.disabled_at) {
    throw Object.assign(new Error("invalid or disabled API key"), {
      statusCode: 401,
      code: "unauthorized",
    });
  }

  if (record.key_hash && !safeEqual(record.key_hash, keyHash)) {
    throw Object.assign(new Error("invalid API key"), {
      statusCode: 401,
      code: "unauthorized",
    });
  }

  return {
    api_key_id: record.id,
    user_id: record.user_id,
    caller_id: record.caller_id,
  } satisfies ApiKeyAuth;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function localDevSession() {
  const configured = process.env.TOOLROUTER_DEV_USER_ID || DEFAULT_DEV_USER_ID;
  if (!isUuid(configured)) {
    throw Object.assign(new Error("TOOLROUTER_DEV_USER_ID must be a UUID when set"), {
      statusCode: 500,
      code: "dev_auth_misconfigured",
    });
  }
  return {
    user_id: configured,
    email: process.env.TOOLROUTER_DEV_SUPABASE_EMAIL || "dev@toolrouter.local",
  } satisfies UserSession;
}

async function supabaseAuthAdmin(path: string, { method = "GET", body }: any = {}) {
  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || data?.msg || `Supabase Auth Admin failed: ${response.status}`), {
      statusCode: response.status >= 500 ? 502 : response.status,
      code: "supabase_auth_admin_error",
    });
  }
  return data;
}

function usersFromAdminList(body: any) {
  if (Array.isArray(body?.users)) return body.users;
  if (Array.isArray(body)) return body;
  return [];
}

async function findDevSupabaseUser(email: string) {
  const body = await supabaseAuthAdmin("/admin/users?per_page=200&page=1");
  return usersFromAdminList(body).find((user: any) => String(user.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function ensureDevSupabaseSession() {
  const configuredUserId = process.env.TOOLROUTER_DEV_SUPABASE_USER_ID || process.env.TOOLROUTER_DEV_USER_ID;
  const email = process.env.TOOLROUTER_DEV_SUPABASE_EMAIL || "toolrouter-dev@example.com";
  if (configuredUserId) {
    if (!isUuid(configuredUserId)) {
      throw Object.assign(new Error("TOOLROUTER_DEV_SUPABASE_USER_ID must be a UUID when set"), {
        statusCode: 500,
        code: "dev_auth_misconfigured",
      });
    }
    return { user_id: configuredUserId, email } satisfies UserSession;
  }

  const existing = await findDevSupabaseUser(email);
  if (existing?.id) return { user_id: existing.id, email: existing.email || email } satisfies UserSession;

  const password = `ToolRouter-dev-${randomBytes(24).toString("base64url")}!`;
  try {
    const created = await supabaseAuthAdmin("/admin/users", {
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { toolrouter_dev: true },
      },
    });
    if (created?.id) return { user_id: created.id, email: created.email || email } satisfies UserSession;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|duplicate|exists/i.test(message)) throw error;
  }

  const afterCreate = await findDevSupabaseUser(email);
  if (afterCreate?.id) return { user_id: afterCreate.id, email: afterCreate.email || email } satisfies UserSession;

  throw Object.assign(new Error("unable to create or find ToolRouter dev Supabase user"), {
    statusCode: 502,
    code: "supabase_auth_admin_error",
  });
}

async function devSession() {
  const hasSupabaseStore = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!hasSupabaseStore) return localDevSession();
  devSupabaseUserPromise ||= ensureDevSupabaseSession();
  return devSupabaseUserPromise;
}

export async function authenticateSupabaseUser(headers: Record<string, string | string[] | undefined>) {
  const token = bearerToken(headers);
  if (!token) {
    throw Object.assign(new Error("missing bearer Supabase session"), {
      statusCode: 401,
      code: "session_required",
    });
  }

  if (process.env.ROUTER_DEV_MODE === "true" && token === DEV_SESSION_TOKEN) {
    return devSession();
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) {
    throw Object.assign(new Error("invalid Supabase session"), {
      statusCode: 401,
      code: "session_required",
    });
  }
  return { user_id: body.id, email: body.email || null } satisfies UserSession;
}
