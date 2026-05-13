import { randomUUID } from "node:crypto";

type MagicLinkRequest = {
  email: string;
  onboardingSessionId: string;
  redirectTo?: string | null;
};

function bool(value: unknown) {
  return value === true || value === "true";
}

function appBase() {
  return (process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL || "http://127.0.0.1:3000").replace(/\/$/u, "");
}

function defaultRedirectTo(onboardingSessionId: string) {
  const target = new URL("/onboarding/confirm", appBase());
  target.searchParams.set("session", onboardingSessionId);
  return target.toString();
}

async function supabaseAuthAdmin(path: string, { method = "GET", body }: any = {}) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/u, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error("Supabase auth admin is not configured"), {
      statusCode: 501,
      code: "supabase_auth_not_configured",
    });
  }

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
      details: data,
    });
  }
  return data;
}

export function createOnboardingAuthClient() {
  return {
    async createMagicLink({ email, onboardingSessionId, redirectTo }: MagicLinkRequest) {
      const resolvedRedirectTo = redirectTo || defaultRedirectTo(onboardingSessionId);
      if (bool(process.env.ROUTER_DEV_MODE) && !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
        const url = new URL("/auth/confirm", appBase());
        url.searchParams.set("token_hash", `dev_${randomUUID()}`);
        url.searchParams.set("type", "magiclink");
        url.searchParams.set("redirect_to", resolvedRedirectTo);
        return {
          auth_url: url.toString(),
          provider: "supabase-dev",
        };
      }

      const body = await supabaseAuthAdmin("/admin/generate_link", {
        method: "POST",
        body: {
          type: "magiclink",
          email,
          options: {
            redirect_to: resolvedRedirectTo,
          },
        },
      });
      return {
        auth_url: body?.properties?.action_link || body?.action_link || null,
        provider: "supabase",
      };
    },
  };
}
