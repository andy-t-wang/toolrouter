#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAPIKey } from "@crossmint/common-sdk-base";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv(join(repoRoot, ".env"));
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage(0);
}

const signerSecret = args.generate
  ? `xmsk1_${randomBytes(32).toString("hex")}`
  : pick(args.secret, process.env.CROSSMINT_SIGNER_SECRET, env.CROSSMINT_SIGNER_SECRET);

if (!signerSecret) {
  console.error("Missing CROSSMINT_SIGNER_SECRET. Pass --generate or set it in .env.");
  usage(1);
}

const apiKey = pick(
  args.apiKey,
  process.env.CROSSMINT_SERVER_SIDE_API_KEY,
  process.env.CROSSMINT_API_KEY,
  env.CROSSMINT_SERVER_SIDE_API_KEY,
  env.CROSSMINT_API_KEY,
);

let projectId = args.projectId;
let environment = args.environment;

if (apiKey) {
  const parsed = validateAPIKey(apiKey);
  if (!parsed.isValid) {
    throw new Error(`Invalid Crossmint API key: ${parsed.message}`);
  }
  projectId ||= parsed.projectId;
  environment ||= parsed.environment;
}

if (!projectId || !environment) {
  console.error("Missing Crossmint project context.");
  console.error("Set CROSSMINT_SERVER_SIDE_API_KEY in .env, or pass --project-id and --environment.");
  usage(1);
}

const chain = pick(args.chain, process.env.CROSSMINT_CHAIN, env.CROSSMINT_CHAIN, "base");
const { deriveServerSignerDetails } = await importCrossmintSignerHelpers();
const details = deriveServerSignerDetails({ type: "server", secret: signerSecret }, chain, projectId, environment);
const shouldShowSecret = args.generate || args.showSecret;

console.log("# Crossmint server signer values");
console.log(`# project_id=${projectId}`);
console.log(`# environment=${environment}`);
console.log(`# chain=${chain}`);
console.log(
  shouldShowSecret
    ? `CROSSMINT_SIGNER_SECRET=${signerSecret}`
    : `CROSSMINT_SIGNER_SECRET=${redact(signerSecret)}`,
);
console.log(`CROSSMINT_SERVER_SIGNER_ADDRESS=${details.derivedAddress}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--generate") {
      parsed.generate = true;
    } else if (arg === "--show-secret") {
      parsed.showSecret = true;
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

function redact(value) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
}

async function importCrossmintSignerHelpers() {
  const helperPath = join(
    repoRoot,
    "node_modules",
    "@crossmint",
    "wallets-sdk",
    "dist",
    "signers",
    "server",
    "helpers",
    "index.js",
  );
  return import(pathToFileURL(helperPath).href);
}

function usage(exitCode) {
  console.log(`
Usage:
  npm run crossmint:signer -- --generate
  npm run crossmint:signer
  npm run crossmint:signer -- --secret xmsk1_... --project-id <id> --environment staging --chain base

Notes:
  - Reads .env automatically when present.
  - --generate prints a new CROSSMINT_SIGNER_SECRET once.
  - Without --generate, the existing secret is redacted unless --show-secret is passed.
`);
  process.exit(exitCode);
}
