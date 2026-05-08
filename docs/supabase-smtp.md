# Supabase Auth SMTP

ToolRouter uses Supabase Auth magic links for dashboard login. Production must use a custom SMTP provider; Supabase's shared sender is rate-limited and not intended for public auth flows.

## Provider

Use Resend SMTP for the MVP.

- Host: `smtp.resend.com`
- Port: `587`
- Username: `resend`
- Password: a Resend API key
- From: `ToolRouter <auth@toolrouter.world>`

Before enabling this in Supabase, verify `toolrouter.world` in Resend and add the Resend DNS records for SPF/DKIM. Add a DMARC record if one is not already present.

## Apply Supabase Auth Config

Set these locally, not in the browser bundle:

```sh
SUPABASE_PROJECT_REF=wdgsbgyaqltvcvyatkpp
SUPABASE_ACCESS_TOKEN=<supabase-management-token>
SUPABASE_AUTH_SITE_URL=https://toolrouter.world
SUPABASE_AUTH_REDIRECT_URLS=https://toolrouter.world/dashboard,https://toolrouter.world/**,http://localhost:3000/**,http://127.0.0.1:3000/**
SUPABASE_SMTP_ADMIN_EMAIL=auth@toolrouter.world
SUPABASE_SMTP_SENDER_NAME=ToolRouter
SUPABASE_SMTP_HOST=smtp.resend.com
SUPABASE_SMTP_PORT=587
SUPABASE_SMTP_USER=resend
SUPABASE_SMTP_PASS=<resend-api-key>
```

Then run:

```sh
npm run supabase:auth-config -- --dry-run
npm run supabase:auth-config
npm run supabase:auth-email
```

If the Resend domain is not verified yet, apply only the production Site URL and redirect allow list:

```sh
npm run supabase:auth-config -- --url-only
```

The confirmation email should link to `https://toolrouter.world/auth/confirm?...`, not directly to the Supabase project URL. That route exchanges Supabase's `token_hash` with `verifyOtp` and redirects into `/dashboard` with the session fragment expected by the dashboard.

After applying the config, run a production smoke test by requesting a magic link from `https://toolrouter.world/dashboard`. The received email link must be on `toolrouter.world`, and the embedded redirect must resolve to `https://toolrouter.world/dashboard`, not `localhost`.

## Notes

- Do not store `SUPABASE_ACCESS_TOKEN` in DigitalOcean app env. It is an operator credential for configuration only.
- Do not expose SMTP credentials through `NEXT_PUBLIC_*` values.
- Keep localhost redirect URLs for development, but production Site URL must stay `https://toolrouter.world`.
