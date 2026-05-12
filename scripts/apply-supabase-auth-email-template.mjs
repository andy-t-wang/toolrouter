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

const confirmationTemplatePath = join(repoRoot, "supabase", "email-templates", "confirmation.html");
const magicLinkTemplatePath = join(repoRoot, "supabase", "email-templates", "magic-link.html");
const confirmationContent = readFileSync(confirmationTemplatePath, "utf8");
const magicLinkContent = readFileSync(magicLinkTemplatePath, "utf8");
const confirmationSubject = pick(args.confirmationSubject, args.subject, "Confirm your ToolRouter account");
const magicLinkSubject = pick(args.magicLinkSubject, "Sign in to ToolRouter");
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

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        projectRef,
        confirmation: {
          subject: confirmationSubject,
          templatePath: confirmationTemplatePath,
          contentBytes: Buffer.byteLength(confirmationContent),
        },
        magic_link: {
          subject: magicLinkSubject,
          templatePath: magicLinkTemplatePath,
          contentBytes: Buffer.byteLength(magicLinkContent),
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

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    mailer_subjects_confirmation: confirmationSubject,
    mailer_templates_confirmation_content: confirmationContent,
    mailer_subjects_magic_link: magicLinkSubject,
    mailer_templates_magic_link_content: magicLinkContent,
  }),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Supabase auth template update failed: ${response.status} ${body}`);
}

console.log(`Updated Supabase confirmation and magic-link email templates for project ${projectRef}.`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
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

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
}

function usage(exitCode) {
  console.log(`
Usage:
  npm run supabase:auth-email
  npm run supabase:auth-email -- --dry-run
  npm run supabase:auth-email -- --project-ref <ref> --access-token <token>
  npm run supabase:auth-email -- --confirmation-subject "Confirm your ToolRouter account" --magic-link-subject "Sign in to ToolRouter"

Required:
  SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens
    SUPABASE_ACCESS_KEY is accepted as a compatibility alias.
  SUPABASE_PROJECT_REF, or SUPABASE_URL so the project ref can be inferred
`);
  process.exit(exitCode);
}
