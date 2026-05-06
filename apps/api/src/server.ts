import { createApiApp } from "./app.ts";

const host = process.env.TOOLROUTER_API_HOST || process.env.AGENTKIT_ROUTER_HOST || "127.0.0.1";
const port = Number(process.env.TOOLROUTER_API_PORT || process.env.AGENTKIT_ROUTER_PORT || process.env.PORT || "9402");

const app = createApiApp();
await app.listen({ host, port });

if (process.env.ROUTER_DEV_MODE === "true") {
  app.log.info({ dev_api_key: process.env.AGENTKIT_ROUTER_DEV_API_KEY || "dev_agentkit_router_key" }, "dev mode enabled");
}
