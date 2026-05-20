// POST /v1/requests — execution route. Thin wrapper around
// `runExecution(deps, ctx)` so the orchestrator stays Fastify-free and
// unit-testable.

import { authenticateApiKey } from "@toolrouter/auth";

import { paymentSignerForRequest } from "../services/agentkit-account.ts";
import { runExecution } from "../services/execution/orchestrator.ts";

function clientIp(request: any) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return forwarded || request.ip || undefined;
}

export async function executionRoutes(app: any) {
  const { store, executor, cache, crossmint, datadog } = app;

  app.post("/v1/requests", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    return runExecution(
      {
        store,
        executor,
        cache,
        datadog,
        resolvePaymentSigner: (currentAuth) =>
          paymentSignerForRequest(store, crossmint, currentAuth),
      },
      {
        auth,
        body: request.body || {},
        ip: clientIp(request),
        logger: request.log,
      },
    );
  });
}
