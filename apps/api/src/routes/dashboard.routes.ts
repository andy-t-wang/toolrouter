// /v1/dashboard/* dashboard-only surfaces (auth: Supabase user). Wraps the
// monitoring builders that live in `services/monitoring.ts`.

import { authenticateSupabaseUser } from "@toolrouter/auth";

import {
  dashboardRequestDto,
  monitoringPayload,
  requestFilters,
  requestPage,
} from "../services/monitoring.ts";

export async function dashboardRoutes(app: any) {
  const { store } = app;

  app.get("/v1/dashboard/requests", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const filters = requestFilters(request.query || {});
    filters.user_id = user.user_id;
    return requestPage(store, filters, dashboardRequestDto);
  });

  app.get("/v1/dashboard/monitoring", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { monitoring: await monitoringPayload(store, user.user_id) };
  });
}
