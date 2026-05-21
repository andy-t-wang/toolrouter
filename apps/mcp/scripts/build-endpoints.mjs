#!/usr/bin/env node
// Codegen for `dist/endpoints.json` -- the bundled fallback manifest the
// published MCP package reads when the live ToolRouter API manifest is
// unavailable. The API and package build both derive from router-core's shared
// MCP projection so endpoint deploys and npm artifacts do not drift.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMcpManifest } from "../../../packages/router-core/src/index.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultOutPath = join(scriptDir, "..", "dist", "endpoints.json");

export function endpointsManifestSnapshot() {
  return buildMcpManifest();
}

export function writeEndpointsManifest(outPath = defaultOutPath) {
  const manifest = endpointsManifestSnapshot();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  writeEndpointsManifest();
  process.stdout.write(`build-endpoints: wrote ${defaultOutPath}\n`);
}
