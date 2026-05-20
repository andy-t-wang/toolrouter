// /v1/agentkit/* — wallet verification + AgentKit registration.
//
// All routes require a Supabase user. The deprecated
// `/v1/wallet/agentkit-verification` route is kept here as a redirect /
// alias with a `Deprecation` header.

import { authenticateSupabaseUser } from "@toolrouter/auth";

import {
  completeAgentKitRegistration,
  prepareAgentKitRegistration,
  verifyAgentKitAccount,
} from "../services/agentkit-account.ts";

export async function agentKitRoutes(app: any) {
  const { store, crossmint, datadog, agentBookVerifier, agentBookRegistration } = app;

  app.post("/v1/agentkit/account-verification", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });

  app.post("/v1/agentkit/registration", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return prepareAgentKitRegistration({
      store,
      crossmint,
      user,
      agentBookRegistration,
    });
  });

  app.post("/v1/agentkit/registration/complete", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const result = await completeAgentKitRegistration({
      store,
      crossmint,
      user,
      body: request.body || {},
      agentBookVerifier,
      agentBookRegistration,
    });
    if (result?.registration?.tx_hash) {
      datadog?.increment?.("toolrouter.agentkit.registrations.count", {
        status: "completed",
      }).catch(() => undefined);
    }
    return result;
  });

  app.post("/v1/wallet/agentkit-verification", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    request.log?.warn?.(
      { route: "/v1/wallet/agentkit-verification" },
      "deprecated wallet AgentKit verification route used",
    );
    datadog?.increment?.("toolrouter.deprecated_routes.count", {
      route: "wallet_agentkit_verification",
    }).catch(() => undefined);
    reply.header("deprecation", "true");
    reply.header("link", '</v1/agentkit/account-verification>; rel="successor-version"');
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });
}
