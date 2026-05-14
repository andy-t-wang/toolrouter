import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  countsAsAgentKitEvidence,
  realizedAgentKitValue,
} from "../../../packages/router-core/src/agentkitValue.ts";

const freeTrialEndpoint = {
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
};

const accessEndpoint = {
  agentkit_value_type: "access",
  agentkit_value_label: "AgentKit-Access",
};

describe("AgentKit value policy", () => {
  it("counts free-trial value only when AgentKit handled the request without charge", () => {
    assert.equal(
      countsAsAgentKitEvidence(freeTrialEndpoint, {
        path: "agentkit",
        charged: false,
      }),
      true,
    );
    assert.equal(
      countsAsAgentKitEvidence(freeTrialEndpoint, {
        path: "agentkit_to_x402",
        charged: true,
      }),
      false,
    );
    assert.deepEqual(
      realizedAgentKitValue(freeTrialEndpoint, {
        path: "agentkit_to_x402",
        charged: true,
      }),
      { agentkit_value_type: null, agentkit_value_label: null },
    );
    assert.deepEqual(
      realizedAgentKitValue(freeTrialEndpoint, {
        ok: false,
        status_code: 402,
        path: "agentkit",
        charged: false,
      }),
      { agentkit_value_type: null, agentkit_value_label: null },
    );
  });

  it("counts access and discount evidence across AgentKit-to-x402 paths", () => {
    assert.equal(
      countsAsAgentKitEvidence(accessEndpoint, {
        path: "agentkit_to_x402",
        charged: true,
      }),
      true,
    );
    assert.deepEqual(
      realizedAgentKitValue(accessEndpoint, {
        ok: true,
        path: "agentkit_to_x402",
        charged: true,
      }),
      {
        agentkit_value_type: "access",
        agentkit_value_label: "AgentKit-Access",
      },
    );
    assert.equal(
      countsAsAgentKitEvidence(accessEndpoint, {
        ok: false,
        status_code: 500,
        path: "agentkit_to_x402",
        charged: true,
      }),
      false,
    );
    assert.equal(
      countsAsAgentKitEvidence(accessEndpoint, {
        status: "failing",
        path: "agentkit_to_x402",
        charged: true,
      }),
      false,
    );
  });
});
