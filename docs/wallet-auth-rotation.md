# Wallet Auth And API-Key Rotation

ToolRouter should not rely on one shared browser-visible key or one shared user wallet.

## Launch Model

- Dashboard users create API keys that are scoped to their Supabase `user_id`.
- API keys are stored as hashes and can be disabled without rotating wallet infrastructure.
- Request execution resolves the authenticated key to one user, then uses that user's server-side wallet signer.
- Crossmint wallet locators, signer secrets, service role keys, payment signatures, and API key hashes stay inside the API process.
- Browser code receives only safe wallet metadata, credit balances, and AgentKit verification booleans.

## Compromise Behavior

If one ToolRouter API key is compromised:

- Disable that key from `/dashboard#keys`.
- Create a replacement key for the same caller or a new caller id.
- Existing dashboard auth, other users, other API keys, and server signer secrets are unaffected.
- The attacker cannot directly extract private keys or payment signatures from the browser.
- Blast radius is limited to the compromised user's ToolRouter credits and emergency x402 ceiling.

## Current Limits

- Product-level per-key daily spend caps are not active yet.
- `maxUsd` is caller protection on each request.
- `X402_MAX_USD_PER_REQUEST` remains the server-side emergency ceiling in the x402 signer path.

## Next Hardening Step

Add per-key policy fields:

- `daily_usd_limit`
- `allowed_endpoint_ids`
- `disabled_reason`
- `last_rotated_at`

Those fields should be enforced before provider execution and shown in the API key table.
