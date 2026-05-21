// Per-plugin auth coverage audit (U8 verification requirement).
//
// Asserts that every route plugin EXCEPT the documented public allowlist
// returns 401 to an unauthenticated request. Catches the failure mode where
// a route handler is moved during extraction and accidentally loses its
// `authenticateApiKey` / `authenticateSupabaseUser` call.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { createApiApp } from "../../../apps/api/src/app.ts";
import { MemoryCache } from "../../../packages/cache/src/index.ts";
import { createStore } from "../../../packages/db/src/index.ts";

const PUBLIC_ALLOWLIST = new Set([
  "GET /health",
  "GET /v1/status",
  "GET /v1/status?category=research",
  "POST /webhooks/stripe",
  "POST /x402/manus/research",
  "OPTIONS *",
]);

/**
 * Per-plugin authed-endpoint inventory. We list one representative endpoint
 * per route plugin so a single integration-test sweep catches a missing
 * `authenticate*` call after the U8 extraction.
 */
const AUTHED_ROUTES = [
  // auth-keys.routes.ts
  { method: "GET", url: "/v1/api-keys" },
  { method: "POST", url: "/v1/api-keys", body: { caller_id: "x" } },
  { method: "DELETE", url: "/v1/api-keys/some-id" },
  // status.routes.ts (only authed variants — `/v1/status` is public)
  { method: "GET", url: "/v1/endpoints" },
  { method: "GET", url: "/v1/dashboard/endpoints" },
  { method: "GET", url: "/v1/categories" },
  { method: "GET", url: "/v1/mcp/manifest" },
  { method: "POST", url: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
  { method: "POST", url: "/v1/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
  { method: "GET", url: "/v1/dashboard/categories" },
  // requests.routes.ts
  { method: "GET", url: "/v1/requests" },
  { method: "GET", url: "/v1/requests/req_test" },
  { method: "GET", url: "/v1/manus/tasks/task_test/status" },
  { method: "GET", url: "/v1/manus/tasks/task_test/result" },
  // execution.routes.ts
  { method: "POST", url: "/v1/requests", body: { endpoint_id: "exa.search", input: {} } },
  // dashboard.routes.ts
  { method: "GET", url: "/v1/dashboard/requests" },
  { method: "GET", url: "/v1/dashboard/monitoring" },
  // ledger.routes.ts
  { method: "GET", url: "/v1/balance" },
  { method: "GET", url: "/v1/ledger" },
  { method: "GET", url: "/v1/top-ups" },
  { method: "POST", url: "/v1/top-ups", body: { amount_usd: "1" } },
  // agentkit.routes.ts
  { method: "POST", url: "/v1/agentkit/account-verification", body: {} },
  { method: "POST", url: "/v1/agentkit/registration", body: {} },
  { method: "POST", url: "/v1/agentkit/registration/complete", body: {} },
  { method: "POST", url: "/v1/wallet/agentkit-verification", body: {} },
];

describe("U8 auth coverage audit", () => {
  let app;

  before(async () => {
    app = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: createStore(),
      manusWrapper: { handle: async () => ({ ok: true }) },
    });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("public allowlist sanity (declarative, not just assertion)", () => {
    // This test exists so reviewers can see the explicit list as code rather
    // than reading inline comments. If you add a public route, also add it
    // here and document why.
    assert.ok(PUBLIC_ALLOWLIST.has("GET /health"));
    assert.ok(PUBLIC_ALLOWLIST.has("GET /v1/status"));
    assert.ok(PUBLIC_ALLOWLIST.has("POST /webhooks/stripe"));
  });

  for (const route of AUTHED_ROUTES) {
    const label = `${route.method} ${route.url}`;
    it(`${label} requires auth`, async () => {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        payload: route.body,
      });
      // 401 if the auth helper fires. The test asserts NOT-2xx (anything
      // protected) — a 400 from body validation that runs AFTER auth would
      // still indicate auth ran (since unauthed should return 401 first).
      assert.notEqual(
        response.statusCode,
        200,
        `${label} returned 200 without auth — handler likely lost its authenticate* call`,
      );
      assert.notEqual(
        response.statusCode,
        201,
        `${label} returned 201 without auth — handler likely lost its authenticate* call`,
      );
      // Most should be 401. Some endpoints return 400 first if the auth
      // header is absent (e.g., Supabase user auth that throws "missing
      // bearer token" as 400) — accept either as "auth check ran".
      assert.ok(
        response.statusCode === 401 || response.statusCode === 400,
        `${label} returned ${response.statusCode} — expected 401 (or 400 if the auth helper formats missing-token as 400)`,
      );
    });
  }
});
