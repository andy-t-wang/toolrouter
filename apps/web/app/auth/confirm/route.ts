import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const appBase = (process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL || "").replace(
  /\/$/u,
  "",
);
const allowedTypes = new Set([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
  "email",
]);

function allowLocalDevSession() {
  return (
    process.env.NEXT_PUBLIC_TOOLROUTER_DEV_AUTH === "true" ||
    process.env.ROUTER_DEV_MODE === "true"
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash") || "";
  const type = requestUrl.searchParams.get("type") || "signup";
  const redirectTo = safeRedirect(
    requestUrl.searchParams.get("redirect_to"),
    requestUrl,
  );

  if (
    allowLocalDevSession() &&
    type === "magiclink" &&
    tokenHash.startsWith("dev_")
  ) {
    return redirectWithSession(redirectTo, {
      accessToken: "dev_supabase_session",
      refreshToken: "dev_supabase_session",
      type,
    });
  }

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
  return redirectWithSession(redirectTo, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt:
      session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in,
    expiresIn: session.expires_in,
    tokenType: session.token_type,
    type,
  });
}

function redirectWithSession(
  redirectTo: string,
  {
    accessToken,
    refreshToken,
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
    expiresIn = 3600,
    tokenType = "bearer",
    type,
  }: {
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
    expiresIn?: number;
    tokenType?: string;
    type: string;
  },
) {
  const resolvedExpiresAt =
    expiresAt || Math.floor(Date.now() / 1000) + expiresIn;
  const hash = new URLSearchParams({
    access_token: accessToken,
    expires_at: String(resolvedExpiresAt),
    expires_in: String(expiresIn),
    refresh_token: refreshToken,
    token_type: tokenType,
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

function safeRedirect(value: string | null, requestUrl: URL) {
  const fallback = `${appBase || requestUrl.origin}/dashboard`;
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    const allowedOrigins = new Set([
      requestUrl.origin,
      ...(appBase ? [new URL(appBase).origin] : []),
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    if (!allowedOrigins.has(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
