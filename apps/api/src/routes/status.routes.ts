// Public + dashboard status / endpoints / categories surfaces.
//
// `/v1/status` is unauthenticated (public landing-page consumption). `/v1/endpoints`
// and `/v1/categories` require an API key. The `/v1/dashboard/*` variants
// require a Supabase user.

import { authenticateApiKey, authenticateSupabaseUser } from "@toolrouter/auth";
import { buildMcpManifest } from "@toolrouter/router-core";

import {
  categoryRows,
  endpointRows,
  publicStatusPayload,
  publicStatusRows,
} from "../services/monitoring.ts";

export async function statusRoutes(app: any) {
  const { store } = app;

  app.get("/v1/status", async (request: any) => {
    const endpoints = await publicStatusRows(store, request.query?.category);
    return publicStatusPayload(endpoints);
  });

  app.get("/v1/endpoints", async (request: any) => {
    await authenticateApiKey(request.headers, store);
    return { endpoints: await endpointRows(store, request.query?.category) };
  });

  app.get("/v1/dashboard/endpoints", async (request: any) => {
    await authenticateSupabaseUser(request.headers);
    return { endpoints: await endpointRows(store, request.query?.category) };
  });

  app.get("/v1/categories", async (request: any) => {
    await authenticateApiKey(request.headers, store);
    return {
      categories: await categoryRows(
        store,
        request.query?.include_empty === "true",
      ),
    };
  });

  app.get("/v1/mcp/manifest", async (request: any) => {
    await authenticateApiKey(request.headers, store);
    return buildMcpManifest();
  });

  app.get("/v1/dashboard/categories", async (request: any) => {
    await authenticateSupabaseUser(request.headers);
    return {
      categories: await categoryRows(
        store,
        request.query?.include_empty === "true",
      ),
    };
  });
}
