import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { safeRedirect } from "../../../apps/web/app/auth/confirm/route.ts";

const ENV_KEYS = [
  "NEXT_PUBLIC_TOOLROUTER_APP_URL",
  "NEXT_PUBLIC_TOOLROUTER_DEV_AUTH",
  "ROUTER_DEV_MODE",
];

function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

describe("auth confirmation redirects", () => {
  let env;

  beforeEach(() => {
    env = saveEnv();
    delete process.env.NEXT_PUBLIC_TOOLROUTER_DEV_AUTH;
    delete process.env.ROUTER_DEV_MODE;
    process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL = "https://toolrouter.world";
  });

  afterEach(() => {
    restoreEnv(env);
  });

  it("allows production app redirects and rejects off-origin redirects", () => {
    const requestUrl = new URL("https://toolrouter.world/auth/confirm");
    assert.equal(
      safeRedirect("https://toolrouter.world/dashboard?tab=billing", requestUrl),
      "https://toolrouter.world/dashboard?tab=billing",
    );
    assert.equal(
      safeRedirect("https://attacker.example/dashboard", requestUrl),
      "https://toolrouter.world/dashboard",
    );
  });

  it("does not allow localhost redirects from production origins", () => {
    const requestUrl = new URL("https://toolrouter.world/auth/confirm");
    assert.equal(
      safeRedirect("http://localhost:3000/dashboard", requestUrl),
      "https://toolrouter.world/dashboard",
    );
  });

  it("does not trust alternate production request origins", () => {
    const requestUrl = new URL("https://preview.toolrouter.example/auth/confirm");
    assert.equal(
      safeRedirect("https://preview.toolrouter.example/dashboard", requestUrl),
      "https://toolrouter.world/dashboard",
    );
  });

  it("allows localhost redirects for local or explicit dev confirmation flows", () => {
    assert.equal(
      safeRedirect(
        "http://localhost:3000/dashboard",
        new URL("http://127.0.0.1:3000/auth/confirm"),
      ),
      "http://localhost:3000/dashboard",
    );

    process.env.NEXT_PUBLIC_TOOLROUTER_DEV_AUTH = "true";
    assert.equal(
      safeRedirect(
        "http://127.0.0.1:3000/dashboard",
        new URL("https://toolrouter.world/auth/confirm"),
      ),
      "http://127.0.0.1:3000/dashboard",
    );
  });
});
