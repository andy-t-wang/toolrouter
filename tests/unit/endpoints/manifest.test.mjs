import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  endpointRegistry,
  endpointSnapshot,
  getEndpoint,
} from "../../../packages/router-core/src/index.ts";

// Snapshot baseline for the EndpointManifest → MaterializedEndpoint projection.
// Update this baseline ONLY when a deliberate manifest shape change ships;
// drift between this baseline and the materialized runtime form indicates
// either an accidental breaking change or a missed-MCP-codegen-update.
const SNAPSHOT_BASELINE = Object.freeze({
  "exa.search": {
    id: "exa.search",
    provider: "exa",
    category: "search",
    name: "Exa Search",
    description: "AgentKit-first neural web search with x402 paid fallback.",
    url_host: "api.exa.ai",
    method: "POST",
    agentkit_value_type: "free_trial",
    agentkit_value_label: "AgentKit-Free Trial",
    agentkit_proof_header: false,
    estimated_cost_usd: 0.007,
    default_payment_mode: "agentkit_first",
    ui_badge: "Search",
    fixture_input: {
      query: "AgentKit examples",
      search_type: "fast",
      num_results: 5,
    },
    field_order: ["query", "search_type", "num_results"],
  },
  "browserbase.session": {
    id: "browserbase.session",
    provider: "browserbase",
    category: "browser_usage",
    name: "Browserbase Session",
    description: "AgentKit-verified x402 browser session creation.",
    url_host: "x402.browserbase.com",
    method: "POST",
    agentkit_value_type: "access",
    agentkit_value_label: "AgentKit-Access",
    agentkit_proof_header: true,
    estimated_cost_usd: 0.01,
    default_payment_mode: "agentkit_first",
    ui_badge: "Browser",
    fixture_input: { estimated_minutes: 5 },
    field_order: ["estimated_minutes"],
  },
  "manus.research": {
    id: "manus.research",
    provider: "manus",
    category: "research",
    name: "Manus Research",
    description: "Agentic research task creation through ToolRouter's x402 Manus wrapper.",
    // Note: url_host depends on TOOLROUTER_X402_PROVIDER_URL env. Default is
    // toolrouter.world; tests may run with a local override. Compute at
    // assertion time and assert membership.
    method: "POST",
    agentkit_value_type: "free_trial",
    agentkit_value_label: "AgentKit-Free Trial",
    agentkit_proof_header: false,
    estimated_cost_usd: 0.05,
    default_payment_mode: "agentkit_first",
    ui_badge: "Research",
    fixture_input: {
      query: "Find the best MCP browser automation tools for agent workflows",
      task_type: "tool_discovery",
      depth: "standard",
    },
    field_order: ["query", "task_type", "depth"],
  },
  "parallel.search": {
    id: "parallel.search",
    provider: "parallel",
    category: "search",
    name: "Parallel Search",
    description: "Keyword-driven web search through ToolRouter's x402 Parallel wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0.02,
    default_payment_mode: "x402_only",
    ui_badge: "Search",
    fixture_input: {
      search_queries: ["top sushi places San Francisco"],
      mode: "advanced",
    },
    field_order: ["search_queries", "mode"],
  },
  "parallel.extract": {
    id: "parallel.extract",
    provider: "parallel",
    category: "extract",
    name: "Parallel Extract",
    description: "URL content extraction through ToolRouter's x402 Parallel wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0.02,
    default_payment_mode: "x402_only",
    ui_badge: "Extract",
    fixture_input: {
      urls: ["https://example.com"],
    },
    field_order: ["urls"],
  },
  "parallel.task": {
    id: "parallel.task",
    provider: "parallel",
    category: "research",
    name: "Parallel Task",
    description: "Asynchronous deep-research task through ToolRouter's x402 Parallel wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0.31,
    default_payment_mode: "x402_only",
    ui_badge: "Research",
    fixture_input: {
      input: "Find the best MCP browser automation tools for agent workflows",
      processor: "core",
    },
    field_order: ["input", "processor"],
  },
  "agentmail.create_inbox": {
    id: "agentmail.create_inbox",
    provider: "agentmail",
    category: "email",
    name: "AgentMail Create Inbox",
    description: "Create a new AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 2.01,
    default_payment_mode: "x402_only",
    ui_badge: "Email",
    fixture_input: {
      username: "toolrouter-demo",
      display_name: "ToolRouter Demo",
      client_id: "toolrouter-demo-inbox",
    },
    field_order: ["username", "display_name", "client_id"],
  },
  "agentmail.list_messages": {
    id: "agentmail.list_messages",
    provider: "agentmail",
    category: "email",
    name: "AgentMail List Messages",
    description: "List messages in an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper.",
    url_host: "toolrouter.world",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0,
    default_payment_mode: "x402_only",
    ui_badge: "Email",
    fixture_input: {
      inbox_id: "agent@example.com",
      limit: 10,
    },
    field_order: ["inbox_id", "limit"],
  },
  "agentmail.get_message": {
    id: "agentmail.get_message",
    provider: "agentmail",
    category: "email",
    name: "AgentMail Get Message",
    description: "Fetch a single AgentMail message through ToolRouter's server-side x402 AgentMail wrapper.",
    url_host: "toolrouter.world",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0,
    default_payment_mode: "x402_only",
    ui_badge: "Email",
    fixture_input: {
      inbox_id: "agent@example.com",
      message_id: "msg_123",
    },
    field_order: ["inbox_id", "message_id"],
  },
  "agentmail.send_message": {
    id: "agentmail.send_message",
    provider: "agentmail",
    category: "email",
    name: "AgentMail Send Message",
    description: "Send an email from an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0.02,
    default_payment_mode: "x402_only",
    ui_badge: "Email",
    fixture_input: {
      inbox_id: "agent@example.com",
      to: "recipient@example.com",
      subject: "Hello from ToolRouter",
      text: "Hello from AgentMail via ToolRouter.",
    },
    field_order: ["inbox_id", "to", "subject", "text"],
  },
  "agentmail.reply_to_message": {
    id: "agentmail.reply_to_message",
    provider: "agentmail",
    category: "email",
    name: "AgentMail Reply To Message",
    description: "Reply to an AgentMail message through ToolRouter's server-side x402 AgentMail wrapper.",
    method: "POST",
    agentkit_value_type: null,
    agentkit_value_label: null,
    agentkit_proof_header: false,
    estimated_cost_usd: 0.02,
    default_payment_mode: "x402_only",
    ui_badge: "Email",
    fixture_input: {
      inbox_id: "agent@example.com",
      message_id: "msg_123",
      text: "Thanks for the note.",
    },
    field_order: ["inbox_id", "message_id", "text"],
  },
});

const VARIABLE_URL_HOST_IDS = new Set([
  "manus.research",
  "parallel.search",
  "parallel.extract",
  "parallel.task",
  "agentmail.create_inbox",
  "agentmail.send_message",
  "agentmail.reply_to_message",
]);

describe("EndpointManifest snapshot", () => {
  for (const endpointId of Object.keys(SNAPSHOT_BASELINE)) {
    it(`materializeEndpoint(${endpointId}) matches the snapshot baseline`, () => {
      const endpoint = getEndpoint(endpointId);
      const snapshot = endpointSnapshot(endpoint);
      const baseline = SNAPSHOT_BASELINE[endpointId];

      if (VARIABLE_URL_HOST_IDS.has(endpointId)) {
        // url_host varies with env; assert separately as a non-empty hostname.
        const { url_host, ...rest } = snapshot;
        assert.ok(url_host && url_host.length > 0, "url_host must be a non-empty hostname");
        assert.deepEqual(rest, baseline);
      } else {
        assert.deepEqual(snapshot, baseline);
      }
    });
  }

  it("registry order is stable and matches the baseline", () => {
    const ids = endpointRegistry.map((endpoint) => endpoint.id);
    assert.deepEqual(ids, [
      "browserbase.session",
      "exa.search",
      "parallel.search",
      "parallel.extract",
      "manus.research",
      "parallel.task",
      "agentmail.create_inbox",
      "agentmail.list_messages",
      "agentmail.get_message",
      "agentmail.send_message",
      "agentmail.reply_to_message",
    ]);
  });

  it("every registered endpoint produces a valid snapshot", () => {
    for (const endpoint of endpointRegistry) {
      const snapshot = endpointSnapshot(endpoint);
      assert.equal(typeof snapshot.id, "string");
      assert.equal(typeof snapshot.provider, "string");
      assert.equal(typeof snapshot.name, "string");
      assert.equal(typeof snapshot.description, "string");
      assert.ok(["GET", "POST"].includes(snapshot.method));
      assert.ok(
        snapshot.agentkit_value_type === null ||
          ["free_trial", "access", "discount"].includes(snapshot.agentkit_value_type),
      );
      assert.equal(typeof snapshot.agentkit_proof_header, "boolean");
      assert.equal(typeof snapshot.estimated_cost_usd, "number");
      assert.ok(Array.isArray(snapshot.field_order));
      assert.ok(snapshot.field_order.length >= 1);
    }
  });
});
