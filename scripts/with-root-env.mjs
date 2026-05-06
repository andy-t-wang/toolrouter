import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, ".env");

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/gu, "\n").replace(/\\r/gu, "\r").replace(/\\t/gu, "\t");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function readRootEnv() {
  try {
    const parsed = {};
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
      if (!match) continue;
      parsed[match[1]] = unquote(match[2]);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-root-env.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: { ...readRootEnv(), ...process.env },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
