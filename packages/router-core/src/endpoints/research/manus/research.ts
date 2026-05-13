import { buildManusResearchRequest, manusResearchPriceForDepth } from "../../builders.ts";

function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

export const manusResearchEndpointDefinition = Object.freeze({
  id: "manus.research",
  provider: "manus",
  category: "research",
  name: "Manus Research",
  description: "Agentic research task creation through ToolRouter's x402 Manus wrapper.",
  url: `${wrapperBaseUrl()}/x402/manus/research`,
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.05,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Research",
    fixture_label: "Start Manus research",
  },
  fixture_input: {
    query: "Find the best MCP browser automation tools for agent workflows",
    task_type: "tool_discovery",
    depth: "standard",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: manusResearchPriceForDepth("quick"),
    timeout_ms: 30_000,
    latency_budget_ms: 30_000,
    input: {
      query: "ToolRouter health check: return one sentence about Manus research availability",
      task_type: "health_check",
      depth: "quick",
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: manusResearchPriceForDepth("quick"),
    timeout_ms: 30_000,
    latency_budget_ms: 30_000,
    input: {
      query: "ToolRouter AgentKit health check: return one sentence about Manus research availability",
      task_type: "health_check",
      depth: "quick",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: manusResearchPriceForDepth("quick"),
      input: {
        query: "ToolRouter AgentKit smoke test for Manus research",
        task_type: "health_check",
        depth: "quick",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: manusResearchPriceForDepth("quick"),
      input: {
        query: "ToolRouter x402 smoke test for Manus research",
        task_type: "health_check",
        depth: "quick",
      },
    },
  },
  builder: buildManusResearchRequest,
});
