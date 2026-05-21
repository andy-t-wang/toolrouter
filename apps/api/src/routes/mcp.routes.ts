// Hosted MCP HTTP transport. The npm package remains the stdio adapter, but
// remote-capable clients can connect directly to this route with an API key.

import { authenticateApiKey, bearerToken } from "@toolrouter/auth";

import { handleJsonRpcMessage } from "../../../mcp/src/server.ts";

const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "ping",
  "notifications/initialized",
]);

function methodRequiresAuth(message: any) {
  if (!message || typeof message !== "object") return false;
  if (typeof message.method !== "string") return false;
  return !PUBLIC_MCP_METHODS.has(message.method);
}

function payloadRequiresAuth(payload: any) {
  const messages = Array.isArray(payload) ? payload : [payload];
  return messages.some(methodRequiresAuth);
}

function responseHeaders(headers: Record<string, string | string[] | number | undefined>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return normalized;
}

function requestHeaders(headers: HeadersInit = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function injectFetch(app: any) {
  return async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const result = await app.inject({
      method: init.method || "GET",
      url: `${parsed.pathname}${parsed.search}`,
      headers: requestHeaders(init.headers),
      payload: init.body,
    });
    return new Response(result.body, {
      status: result.statusCode,
      headers: responseHeaders(result.headers),
    });
  };
}

async function handlePayload(payload: any, options: any) {
  if (Array.isArray(payload)) {
    const responses = await Promise.all(
      payload.map((message) => handleJsonRpcMessage(message, options)),
    );
    return responses.filter(Boolean);
  }
  return handleJsonRpcMessage(payload, options);
}

export async function mcpRoutes(app: any) {
  const { store } = app;
  const fetchImpl = injectFetch(app);

  async function handleMcpPost(request: any, reply: any) {
    if (payloadRequiresAuth(request.body)) {
      await authenticateApiKey(request.headers, store);
    }
    const apiKey = bearerToken(request.headers) || "";
    const payload = await handlePayload(request.body, {
      env: {
        ...process.env,
        TOOLROUTER_API_URL: "http://toolrouter.local",
        TOOLROUTER_API_KEY: apiKey,
      },
      fetchImpl,
    });
    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      reply.status(202).send();
      return;
    }
    reply.header("mcp-protocol-version", "2025-11-25");
    return payload;
  }

  app.post("/mcp", handleMcpPost);
  app.post("/v1/mcp", handleMcpPost);
}
