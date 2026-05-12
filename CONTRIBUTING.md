# Contributing

Thanks for helping improve ToolRouter.

## Development

```bash
npm install
npm run type-check
npm test
```

`npm test` is deterministic and must not spend money or call live providers.

Live provider checks are opt-in:

```bash
npm run test:live:endpoints
```

Only run live checks with the required `RUN_LIVE_*` flags, strict spend caps, and test credentials.

## Endpoint Changes

When adding an endpoint, include:

- Endpoint metadata and UI metadata
- Typed input validation
- Fixture input
- Health probe and live smoke config
- Registry/builder/executor tests as needed
- AgentKit benefit classification: free trial, access, discount, or none

Do not commit provider API keys, wallet secrets, payment headers, raw provider responses, Supabase service role keys, or local `.env` files.
