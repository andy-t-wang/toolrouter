import { createApiApp } from "./app.ts";

const host = process.env.TOOLROUTER_API_HOST || process.env.AGENTKIT_ROUTER_HOST || "127.0.0.1";
const port = Number(process.env.TOOLROUTER_API_PORT || process.env.AGENTKIT_ROUTER_PORT || process.env.PORT || "9402");

// Production opts into eager seller-service init so misconfiguration
// (missing MANUS_API_KEY, bad CDP credentials) fails synchronously at boot
// rather than 503ing on first traffic. Local dev (ROUTER_DEV_MODE=true)
// stays lazy so the server starts without provider credentials configured.
const eagerSellerInit = process.env.ROUTER_DEV_MODE !== "true";

const app = createApiApp({ eagerSellerInit });
await app.listen({ host, port });

if (process.env.ROUTER_DEV_MODE === "true") {
  app.log.info({ dev_mode: true }, "dev mode enabled");
}
