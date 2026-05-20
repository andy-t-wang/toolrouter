import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildParallelTaskRequest, parallelTaskPriceForProcessor } from "../../builders.ts";

function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

export const parallelTaskEndpointDefinition = Object.freeze({
  id: "parallel.task",
  provider: "parallel",
  category: "research",
  name: "Parallel Task",
  description: "Asynchronous deep-research task through ToolRouter's x402 Parallel wrapper.",
  url: `${wrapperBaseUrl()}/x402/parallel/task`,
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.31,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Research",
    fixture_label: "Start Parallel task",
  },
  fixture_input: {
    input: "Find the best MCP browser automation tools for agent workflows",
    processor: "core",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: parallelTaskPriceForProcessor("core"),
    timeout_ms: 30000,
    latency_budget_ms: 30000,
    input: {
      input: "ToolRouter health check: one sentence about Parallel task availability.",
      processor: "core",
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: parallelTaskPriceForProcessor("core"),
    timeout_ms: 30000,
    latency_budget_ms: 30000,
    input: {
      input: "ToolRouter AgentKit health check: one sentence about Parallel task availability.",
      processor: "core",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: parallelTaskPriceForProcessor("core"),
      input: {
        input: "ToolRouter AgentKit smoke test for Parallel task.",
        processor: "core",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: parallelTaskPriceForProcessor("core"),
      input: {
        input: "ToolRouter x402 smoke test for Parallel task.",
        processor: "core",
      },
    },
  },
  builder: buildParallelTaskRequest,
}) satisfies EndpointManifest;
