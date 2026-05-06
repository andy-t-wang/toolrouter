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

export async function authenticateSupabaseUser(headers: Record<string, string | string[] | undefined>) {
  const token = bearerToken(headers);
  if (!token) {
    throw Object.assign(new Error("missing bearer Supabase session"), {
      statusCode: 401,
      code: "session_required",
    });
  }

  if (process.env.ROUTER_DEV_MODE === "true" && token === "dev_supabase_session") {
    return { user_id: "dev-user", email: "dev@toolrouter.local" } satisfies UserSession;
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
