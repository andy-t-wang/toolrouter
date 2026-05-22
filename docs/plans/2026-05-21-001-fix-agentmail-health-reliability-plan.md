# Fix AgentMail Health Reliability Plan

Date: 2026-05-21
Type: fix
Status: in progress

## Problem

AgentMail is reported as degraded/failing in the public ToolRouter status API even though AgentMail's public status page is operational. The current live status shows all active AgentMail probes returning HTTP 403:

- `agentmail.list_messages`
- `agentmail.get_message`
- `agentmail.send_message`
- `agentmail.reply_to_message`

The public status payload attributes these as generic "Provider rejected request" upstream failures. Datadog logs are not available for this failure path; the log API returned no ToolRouter application logs in the last 24 hours, while the Datadog MCP log connector was still using stale/bad log API configuration until `DD_LOGS_SITE=api.datadoghq.com` was added locally.

## Root Cause

AgentMail ownership is split across two different execution models:

- `create_inbox`, `send_message`, and `reply_to_message` go through ToolRouter-owned x402 wrapper routes under `/x402/agentmail/...`.
- `list_messages` and `get_message` call AgentMail directly at `https://x402.api.agentmail.to/...`.

The wrapper pays upstream AgentMail using the ToolRouter upstream wallet, then records a local `agentmail_inboxes` ownership row mapping the caller's x402 payer to the inbox. Direct read calls do not use that wrapper or local ownership map. For inboxes created through ToolRouter, direct reads can therefore be paid by the wrong payer from AgentMail's perspective and fail with 403 even when AgentMail is healthy.

The health worker then makes the incident noisy:

- Recurring health probes collapse all 4xx responses into `Provider rejected request`.
- Permanent 4xx/configuration failures are marked `degraded`, so the worker keeps retrying every 15 minutes and the public status suggests upstream downtime.
- Manual-only endpoints such as `agentmail.create_inbox` still contribute confusing health history with uptime `0`.

## Requirements

- All AgentMail operations that depend on inbox ownership must use a consistent ToolRouter wrapper path.
- AgentMail read wrappers must validate local inbox ownership before forwarding upstream.
- Upstream AgentMail read calls must be made with the same ToolRouter upstream signer used for create/send/reply.
- Normal PR tests must remain deterministic and must not call live AgentMail or spend money.
- Health status should distinguish permanent health fixture/configuration failures from provider downtime.
- Public status errors must stay safe; do not expose payment payloads, secrets, or raw upstream response bodies.

## Implementation Units

### U1: Wrap AgentMail Reads

Files:

- `packages/router-core/src/endpoints/email/agentmail/list-messages.ts`
- `packages/router-core/src/endpoints/email/agentmail/get-message.ts`
- `packages/router-core/src/endpoints/builders.ts`
- `apps/api/src/sellers/agentmail/index.ts`
- `apps/api/src/sellers/agentmail/pricing.ts`
- `apps/api/src/sellers/agentmail/upstream.ts`
- `apps/api/src/routes/sellers.routes.ts`

Approach:

- Add first-party wrapper paths for list/get, using POST request bodies to fit the existing seller primitive.
- Update endpoint builders so `agentmail.list_messages` and `agentmail.get_message` call those wrapper paths rather than AgentMail directly.
- Add upstream forwarders that validate the caller owns the inbox in `agentmail_inboxes`, strip ToolRouter control fields, build the AgentMail GET URL, and forward using the ToolRouter upstream payment signer.
- Register the two new seller services in eager and lazy seller setup.

### U2: Preserve Useful AgentMail 403 Attribution

Files:

- `packages/router-core/src/attribution.ts`
- `packages/router-core/src/health/worker.ts`
- `apps/api/src/services/monitoring.ts`

Approach:

- Teach attribution to recognize safe AgentMail ownership/configuration codes such as `agentmail_inbox_not_owned`.
- Treat non-retryable 400/401/403/404 health probe failures as `unverified` instead of `degraded`, because they indicate bad probe input, missing ownership, or auth/config drift rather than live provider downtime.
- Keep retryable 429/5xx/timeout failures degraded or failing as today.

### U3: Reduce Manual-Probe Noise

Files:

- `apps/api/src/services/monitoring.ts`
- `tests/integration/router/api.test.mjs`
- `tests/unit/health/worker.test.mjs`

Approach:

- Keep manual-only endpoints unverified unless forced.
- Ensure public status summary and uptime calculations do not make manual-only endpoints look like failed availability probes.

### U4: Coverage

Files:

- `tests/unit/endpoints/registry.test.mjs`
- `tests/unit/endpoints/manifest.test.mjs`
- `tests/unit/api/agentmail-sellers.test.mjs`
- `tests/unit/health/worker.test.mjs`
- `tests/integration/router/api.test.mjs`

Scenarios:

- AgentMail list/get endpoint requests target ToolRouter wrapper URLs and preserve request input.
- AgentMail list/get wrappers reject non-owner callers without upstream calls.
- AgentMail list/get wrappers forward authorized reads to AgentMail GET URLs through the upstream signer.
- Health worker marks non-retryable 403 ownership/configuration failures as `unverified`.
- Public status does not turn safe AgentMail ownership failures back into generic provider downtime.

## Validation

Run focused deterministic tests:

- `npm test -- tests/unit/endpoints/registry.test.mjs`
- `npm test -- tests/unit/endpoints/manifest.test.mjs`
- `npm test -- tests/unit/api/agentmail-sellers.test.mjs`
- `npm test -- tests/unit/health/worker.test.mjs`
- `npm test -- tests/integration/router/api.test.mjs`

No live AgentMail smoke should run in this change. After deploy, verify with:

- `curl -s https://toolrouter.world/v1/status`
- A forced worker run only if the production wallet/env is confirmed and spending is acceptable.

## Operator Notes

The Datadog API key and app key were exposed in local process output during debugging. Rotate both after this incident work is complete.
