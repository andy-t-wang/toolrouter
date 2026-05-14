import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const allowedTypes = new Set([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
  "email",
]);

function appBase() {
  return (process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL || "").replace(/\/$/u, "");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash") || "";
  const type = requestUrl.searchParams.get("type") || "signup";
  const redirectTo = safeRedirect(
    requestUrl.searchParams.get("redirect_to"),
    requestUrl,
  );

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectWithError(redirectTo, "auth_not_configured");
  }
  if (!tokenHash || !allowedTypes.has(type)) {
    return redirectWithError(redirectTo, "invalid_auth_link");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as any,
  });

  if (error || !data.session) {
    return redirectWithError(redirectTo, "auth_link_expired");
  }

  const session = data.session;
  const expiresAt =
    session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    expires_at: String(expiresAt),
    expires_in: String(session.expires_in),
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    type,
  });
  const target = new URL(redirectTo);
  target.hash = hash.toString();
  return Response.redirect(target);
}

function redirectWithError(redirectTo: string, code: string) {
  const target = new URL(redirectTo);
  target.hash = new URLSearchParams({
    error: "server_error",
    error_code: code,
    error_description: "Could not verify this login link.",
  }).toString();
  return Response.redirect(target);
}

function isLocalOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function safeRedirect(value: string | null, requestUrl: URL) {
  const base = appBase();
  const fallback = `${base || requestUrl.origin}/dashboard`;
  if (!value) return fallback;
  try {
    const localRedirectsAllowed =
      isLocalOrigin(requestUrl.origin) ||
      process.env.NEXT_PUBLIC_TOOLROUTER_DEV_AUTH === "true" ||
      process.env.ROUTER_DEV_MODE === "true";
    const parsed = new URL(value);
    const appOrigin = base ? new URL(base).origin : requestUrl.origin;
    const allowedOrigins = new Set([
      appOrigin,
      ...(localRedirectsAllowed
        ? ["http://localhost:3000", "http://127.0.0.1:3000"]
        : []),
    ]);
    if (!allowedOrigins.has(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
