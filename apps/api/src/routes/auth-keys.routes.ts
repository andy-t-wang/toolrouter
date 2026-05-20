// /v1/api-keys — list, create, disable. Dashboard-authed (Supabase user).
//
// Plain async Fastify plugin: reads `app.store` from the decorations populated
// by `sharedPlugin`. No `fastify-plugin` dependency.

import { authenticateSupabaseUser } from "@toolrouter/auth";

function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value;
}

export async function authKeysRoutes(app: any) {
  const { store } = app;

  app.get("/v1/api-keys", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { api_keys: await store.listApiKeys({ user_id: user.user_id }) };
  });

  app.post("/v1/api-keys", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const callerId = String(body.caller_id || body.callerId || "").trim();
    if (!callerId) {
      throw Object.assign(new Error("caller_id is required"), {
        statusCode: 400,
        code: "invalid_request",
      });
    }
    const created = await store.createApiKey({
      user_id: user.user_id,
      caller_id: callerId,
    });
    reply.status(201);
    return created;
  });

  app.delete("/v1/api-keys/:id", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return {
      api_key: await store.disableApiKey({
        id: decodeURIComponent(request.params.id),
        user_id: user.user_id,
      }),
    };
  });
}
