---
title: Remove unneeded health diagnostics
date: 2026-05-22
status: completed
---

# Remove Unneeded Health Diagnostics

## Problem

The recent health-worker PRs added broad diagnostic and Datadog log-forwarding code while investigating failing endpoint health. Production evidence later showed the outage was caused by DigitalOcean App Platform env drift: the worker did not have the Crossmint health signer env vars or Datadog env vars configured. The codebase should not keep investigation scaffolding that is not required for normal operation.

## Scope

Remove debug-only code and tests introduced by PRs #38, #39, and #40 where the production root cause was env configuration rather than runtime behavior. Keep the minimal worker behavior that predates those PRs and prevents the worker from falling back to the live wallet or private-key signer. Keep deployment env keys that encode the required production configuration.

## Implementation Units

1. Worker cleanup
   - Files: `apps/worker/src/health-worker.ts`, `tests/unit/worker/health-worker.test.mjs`
   - Restore the worker to the simpler health signer executor: no exported test seams, no signer method wrappers, no Datadog logger, no Crossmint address-resolution factory.
   - Delete the worker-only unit tests added for the diagnostic seams.

2. Datadog cleanup
   - Files: `apps/api/src/services/datadog.ts`, `apps/api/package.json`, `tests/unit/api/datadog.test.mjs`
   - Remove the log-submission helper and package export that only existed for worker log forwarding.
   - Keep the existing metrics helper behavior and metric tests.

3. Documentation cleanup
   - Files: `docs/solutions/developer-experience/agentmail-health-signer-diagnostics.md`
   - Revert guidance that says the worker can rely only on locator-based address resolution, since production is now configured with both health locator and address.

4. Deployment spec
   - File: `deploy/digitalocean-app.yaml`
   - Preserve the worker Crossmint health signer env keys and worker Datadog env keys in the spec, because DigitalOcean missing env was the actual issue and the spec should document required runtime config.

## Tests

- `node --import tsx --test tests/unit/api/datadog.test.mjs tests/unit/health/worker.test.mjs`
- `npm run type-check`
- `npm test`
- `npm --workspace @worldcoin/toolrouter pack --dry-run --cache /private/tmp/npm-cache-c174`

## Risks

- Removing the worker-specific tests reduces direct coverage of `apps/worker/src/health-worker.ts`, but the removed tests were primarily validating investigation seams. Core health worker behavior remains covered in `tests/unit/health/worker.test.mjs`.
- Keeping worker `DD_*` spec keys without direct worker log forwarding may be harmless but currently unused by application code; they remain as deployment configuration because the production investigation specifically needed them available.
