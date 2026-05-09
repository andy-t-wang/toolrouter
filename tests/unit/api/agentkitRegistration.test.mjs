import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters } from "viem";
import { generateSignal } from "@worldcoin/idkit-core/hashing";

import {
  AGENT_BOOK_CONTRACT,
  buildAgentKitVerificationRequest,
  parseAgentKitRelayResponse,
  registrationPayloadFromBody,
} from "../../../apps/api/src/agentkitRegistration.ts";

describe("AgentKit registration helpers", () => {
  it("builds the same IDKit signal shape as the AgentKit CLI", () => {
    const agentAddress = "0xf5876A8bFAd131CAe4b047478222B2Ff992604f4";
    const request = buildAgentKitVerificationRequest({
      agentAddress,
      nonce: 7n,
      appId: "app_test",
      action: "agentbook-registration",
    });

    assert.equal(request.app_id, "app_test");
    assert.equal(request.action, "agentbook-registration");
    assert.equal(request.nonce, "7");
    assert.deepEqual(request.signal, {
      types: ["address", "uint256"],
      values: [agentAddress, "7"],
    });
    assert.equal(
      generateSignal(request.signal).digest,
      generateSignal({
        types: ["address", "uint256"],
        values: [agentAddress, 7n],
      }).digest,
    );
  });

  it("normalizes a World ID proof into the relay registration payload", () => {
    const proof = Array.from({ length: 8 }, (_unused, index) => BigInt(index + 1));
    const encodedProof = encodeAbiParameters([{ type: "uint256[8]" }], [proof]);
    const payload = registrationPayloadFromBody(
      "0xf5876A8bFAd131CAe4b047478222B2Ff992604f4",
      {
        nonce: "7",
        result: {
          merkle_root: "0x01",
          nullifier_hash: "0x02",
          proof: encodedProof,
        },
      },
    );

    assert.equal(payload.contract, AGENT_BOOK_CONTRACT);
    assert.equal(payload.root, "0x01");
    assert.equal(payload.nonce, "7");
    assert.equal(payload.nullifierHash, "0x02");
    assert.deepEqual(
      payload.proof,
      proof.map((value) => `0x${value.toString(16).padStart(64, "0")}`),
    );
  });

  it("turns relay HTML responses into sanitized ToolRouter errors", async () => {
    await assert.rejects(
      () =>
        parseAgentKitRelayResponse(
          new Response("<!DOCTYPE html>", {
            status: 500,
            headers: { "content-type": "text/html" },
          }),
        ),
      (error) => {
        assert.equal(error.code, "agentkit_registration_failed");
        assert.equal(error.statusCode, 502);
        assert.equal(error.details.relay_status, 500);
        assert.equal(error.details.relay_content_type, "text/html");
        assert.match(error.message, /non-JSON response/);
        assert.doesNotMatch(error.message, /DOCTYPE/);
        return true;
      },
    );
  });
});
