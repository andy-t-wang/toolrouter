#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv(join(repoRoot, ".env"));
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage(0);
}

const accessToken = pick(
  args.accessToken,
  process.env.SUPABASE_ACCESS_TOKEN,
  env.SUPABASE_ACCESS_TOKEN,
  process.env.SUPABASE_ACCESS_KEY,
  env.SUPABASE_ACCESS_KEY,
);
const projectRef = pick(
  args.projectRef,
  process.env.SUPABASE_PROJECT_REF,
  env.SUPABASE_PROJECT_REF,
  projectRefFromUrl(pick(process.env.SUPABASE_URL, env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL)),
);
const siteUrl = trimSlash(pick(args.siteUrl, process.env.SUPABASE_AUTH_SITE_URL, env.SUPABASE_AUTH_SITE_URL, "https://toolrouter.world"));
const redirectUrls = normalizeRedirectUrls(
  pick(
    args.redirectUrls,
    process.env.SUPABASE_AUTH_REDIRECT_URLS,
    env.SUPABASE_AUTH_REDIRECT_URLS,
    `${siteUrl}/dashboard,${siteUrl}/**,http://localhost:3000/**,http://127.0.0.1:3000/**`,
  ),
);
const smtpPass = pick(args.smtpPass, process.env.SUPABASE_SMTP_PASS, env.SUPABASE_SMTP_PASS, process.env.RESEND_API_KEY, env.RESEND_API_KEY);
const smtpConfig = {
  smtp_admin_email: pick(args.smtpAdminEmail, process.env.SUPABASE_SMTP_ADMIN_EMAIL, env.SUPABASE_SMTP_ADMIN_EMAIL, `auth@${hostname(siteUrl)}`),
  smtp_host: pick(args.smtpHost, process.env.SUPABASE_SMTP_HOST, env.SUPABASE_SMTP_HOST, "smtp.resend.com"),
  smtp_port: String(pick(args.smtpPort, process.env.SUPABASE_SMTP_PORT, env.SUPABASE_SMTP_PORT, "587")),
  smtp_user: pick(args.smtpUser, process.env.SUPABASE_SMTP_USER, env.SUPABASE_SMTP_USER, "resend"),
  smtp_pass: smtpPass,
  smtp_sender_name: pick(args.smtpSenderName, process.env.SUPABASE_SMTP_SENDER_NAME, env.SUPABASE_SMTP_SENDER_NAME, "ToolRouter"),
};
const smtpMaxFrequency = pick(args.smtpMaxFrequency, process.env.SUPABASE_SMTP_MAX_FREQUENCY, env.SUPABASE_SMTP_MAX_FREQUENCY);
const skipSmtp = Boolean(args.skipSmtp || args.urlOnly);

const payload = {
  site_url: siteUrl,
  uri_allow_list: redirectUrls,
  ...(skipSmtp
    ? {}
    : {
        external_email_enabled: true,
        mailer_autoconfirm: false,
        mailer_secure_email_change_enabled: true,
        ...smtpConfig,
        ...(smtpMaxFrequency ? { smtp_max_frequency: Number(smtpMaxFrequency) } : {}),
      }),
};

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        projectRef,
        payload: {
          ...payload,
          ...(payload.smtp_pass ? { smtp_pass: redact(payload.smtp_pass) } : {}),
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!projectRef) {
  console.error("Missing Supabase project ref. Set SUPABASE_PROJECT_REF or SUPABASE_URL in .env.");
  usage(1);
}

if (!accessToken) {
  console.error("Missing SUPABASE_ACCESS_TOKEN. Create one at https://supabase.com/dashboard/account/tokens.");
  usage(1);
}

if (!skipSmtp && !smtpConfig.smtp_pass) {
  console.error("Missing SMTP password. Set SUPABASE_SMTP_PASS or RESEND_API_KEY.");
  usage(1);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Supabase auth config update failed: ${response.status} ${body}`);
}

console.log(
  skipSmtp
    ? `Updated Supabase Auth URL config for project ${projectRef}.`
    : `Updated Supabase Auth URL and SMTP config for project ${projectRef}.`,
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--skip-smtp") {
      parsed.skipSmtp = true;
    } else if (arg === "--url-only") {
      parsed.urlOnly = true;
    } else if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split("=", 2);
      parsed[toCamelCase(name)] = inlineValue ?? argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function loadEnv(path) {
  if (!existsSync(path)) {
    return {};
  }
  const loaded = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
    loaded[key] = value;
  }
  return loaded;
}

function pick(...values) {
  return values.find((value) => value != null && String(value).length > 0);
}

function projectRefFromUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function trimSlash(value) {
  return String(value).replace(/\/$/u, "");
}

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "toolrouter.world";
  }
}

function normalizeRedirectUrls(value) {
  return String(value)
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

function redact(value) {
  const text = String(value || "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 3)}...${text.slice(-4)}`;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
}

function usage(exitCode) {
  console.log(`
Usage:
  npm run supabase:auth-config
  npm run supabase:auth-config -- --dry-run
  npm run supabase:auth-config -- --url-only
  npm run supabase:auth-config -- --project-ref <ref> --access-token <token>

Required:
  SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens
    SUPABASE_ACCESS_KEY is accepted as a compatibility alias.
  SUPABASE_PROJECT_REF, or SUPABASE_URL so the project ref can be inferred
  SUPABASE_SMTP_PASS or RESEND_API_KEY

Defaults:
  SUPABASE_AUTH_SITE_URL=https://toolrouter.world
  SUPABASE_AUTH_REDIRECT_URLS=https://toolrouter.world/dashboard,https://toolrouter.world/**,http://localhost:3000/**,http://127.0.0.1:3000/**
  SUPABASE_SMTP_HOST=smtp.resend.com
  SUPABASE_SMTP_PORT=587
  SUPABASE_SMTP_USER=resend
  SUPABASE_SMTP_ADMIN_EMAIL=auth@toolrouter.world
  SUPABASE_SMTP_SENDER_NAME=ToolRouter
`);
  process.exit(exitCode);
}
