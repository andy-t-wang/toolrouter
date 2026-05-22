---
title: AgentMail Health Signer Diagnostics
date: 2026-05-22
category: developer-experience
module: ToolRouter health worker and AgentMail x402 wrappers
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - AgentMail health probes return unverified with ownership failures
  - Recurring x402 health probes may use a fallback signer
  - Provider wrapper failures depend on payer ownership state
tags: [agentmail, health-worker, x402, crossmint, diagnostics, logging]
---

# AgentMail Health Signer Diagnostics

## Context

AgentMail health checks became `unverified` more than once with the same public symptom: the status API showed `403` and `AgentMail inbox ownership check failed` for the message endpoints. The public status was enough to prove this was a local ToolRouter ownership rejection, not AgentMail downtime, but it was not enough to answer which signer the worker used or whether the health inbox row was missing versus owned by another payer.

The fragile state is the alignment among three values:

- `CROSSMINT_HEALTH_WALLET_ADDRESS`
- `AGENTMAIL_HEALTH_INBOX_ID`
- `agentmail_inboxes.owner_address`

The worker buyer wallet pays ToolRouter's `/x402/agentmail/*` wrapper. The API wrapper extracts the x402 payer from the payment payload and checks that payer against `agentmail_inboxes.owner_address` before forwarding upstream. If those do not match, the API returns `agentmail_inbox_not_owned` before reaching AgentMail.

## Guidance

Health probes that depend on payment identity need structured, safe diagnostics at both sides of the request.

On the worker side, log the signer selection once at startup and annotate every health execution result with a redacted signer object:

```ts
{
  source: "crossmint_health",
  fallback_used: false,
  crossmint_auth_configured: true,
  private_key_configured: false,
  health_locator_configured: true,
  health_address_configured: true,
  live_locator_configured: false,
  live_address_configured: false,
  selected_locator_source: "health",
  selected_address_source: "health",
  selected_wallet_locator_hash: "sha256:...",
  selected_address_hash: "sha256:..."
}
```

The source should make fallback explicit:

- `crossmint_health`: expected recurring health signer.
- `crossmint_live_fallback`: health env was incomplete and live Crossmint env was used.
- `crossmint_mixed_fallback`: locator and address came from different source classes.
- `agent_wallet_private_key_fallback`: executor fell back to `AGENT_WALLET_PRIVATE_KEY`.
- `unavailable`: no usable signer config was present.

On the API wrapper side, AgentMail ownership failures should distinguish the reason without exposing raw addresses:

```json
{
  "code": "agentmail_inbox_not_owned",
  "diagnostics": {
    "inbox_found": true,
    "reason": "owner_mismatch",
    "payer_address_hash": "sha256:...",
    "stored_owner_address_hash": "sha256:..."
  }
}
```

Use `reason: "missing_inbox_owner_row"` when the configured inbox cannot be found in `agentmail_inboxes`. Use `reason: "owner_mismatch"` when a row exists but belongs to a different payer.

Keep raw wallet addresses, locators, payment payloads, signatures, and provider response bodies out of logs. Hash stable identifiers with a short SHA-256 prefix so repeated incidents can be correlated without leaking secrets.

## Why This Matters

Without signer-source logging, every recurrence looks like "the health wallet changed" even when static env may still be present. The real failure can be any of:

- the worker used the expected health wallet but the health inbox row is stale;
- the worker fell back to live Crossmint env;
- the worker fell back to `AGENT_WALLET_PRIVATE_KEY`;
- the API and worker components have different static env;
- the health inbox env points to an inbox that was provisioned under a different payer.

The next incident should be answerable from one health log line: which signer class was selected, whether fallback happened, whether the inbox row existed, and whether the stored owner hash matched the payer hash.

## When to Apply

- AgentMail endpoint status is `unverified` with `AgentMail inbox ownership check failed`.
- A health probe is x402-paid and the provider or wrapper authorizes by payer address.
- Worker and API components each have their own deployment env blocks.
- A recurring probe depends on seed data created by a one-off provisioning script.

## Examples

Before adding diagnostics, the public status only showed:

```json
{
  "status": "unverified",
  "status_code": 403,
  "last_error": "AgentMail inbox ownership check failed"
}
```

After the logging change, the worker log can show:

```json
{
  "endpoint_id": "agentmail.send_message",
  "status": "unverified",
  "status_code": 403,
  "diagnostics": {
    "provider": {
      "inbox_found": true,
      "reason": "owner_mismatch",
      "payer_address_hash": "sha256:...",
      "stored_owner_address_hash": "sha256:..."
    },
    "health_payment_signer": {
      "source": "agent_wallet_private_key_fallback",
      "fallback_used": true,
      "selected_address_hash": null
    }
  }
}
```

That log immediately says the problem is not AgentMail uptime and not a missing health inbox env. It is a ToolRouter health identity or ownership-row mismatch.

## Related

- `apps/worker/src/health-worker.ts` logs health signer source and fallback state.
- `packages/router-core/src/health/worker.ts` carries safe diagnostics into structured health-check logs.
- `apps/api/src/sellers/agentmail/upstream.ts` returns safe ownership diagnostics for AgentMail wrapper rejections.
- `scripts/provision-agentmail-health.mjs` provisions the health inbox and ownership row that recurring probes depend on.
