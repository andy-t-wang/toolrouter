import { buildFalImageFastRequest } from "../../builders.ts";

export const falImageFastEndpointDefinition = Object.freeze({
  id: "fal.image_fast",
  provider: "fal",
  category: "ai_ml",
  name: "Fal Image Fast",
  description: "Fal-backed image generation through a pure x402 payment endpoint.",
  url: "https://x402-gateway-production.up.railway.app/api/image/fast",
  method: "POST",
  payment_protocol: "x402",
  identity_protocol: "none",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.015,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Image",
    fixture_label: "Generate image",
  },
  fixture_input: {
    prompt: "A small brass robot painting a sunrise",
    width: 1024,
    height: 1024,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 30000,
    input: {
      prompt: "ToolRouter x402 image health check",
      width: 1024,
      height: 1024,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: "0.02",
      input: {
        prompt: "ToolRouter x402 image smoke test",
        width: 1024,
        height: 1024,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.02",
      input: {
        prompt: "ToolRouter forced x402 image smoke test",
        width: 1024,
        height: 1024,
      },
    },
  },
  builder: buildFalImageFastRequest,
});
