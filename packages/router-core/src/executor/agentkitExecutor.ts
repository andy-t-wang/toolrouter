import { randomBytes } from "node:crypto";

function decimalUsdToAtomic(value) {
  const normalized = String(value || "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`invalid USD amount: ${value}`);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

function atomicToUsdString(value) {
  const atomic = BigInt(value);
  const whole = atomic / 1_000_000n;
  const fraction = String(atomic % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function effectivePaymentMaxUsd(maxUsd) {
  const emergencyMax = decimalUsdToAtomic(process.env.X402_MAX_USD_PER_REQUEST || "0.05");
  if (maxUsd === undefined || maxUsd === null || maxUsd === "") return atomicToUsdString(emergencyMax);
  const requestedMax = decimalUsdToAtomic(maxUsd);
  return atomicToUsdString(requestedMax < emergencyMax ? requestedMax : emergencyMax);
}

function normalizedTimeoutMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : null;
}

function timeoutMessage(timeoutMs) {
  return `provider timed out after ${timeoutMs}ms`;
}

function createTimeoutController(timeoutMs) {
  const normalized = normalizedTimeoutMs(timeoutMs);
  if (!normalized) return { timeoutMs: null, signal: null, clear: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(timeoutMessage(normalized)));
  }, normalized);
  timer.unref?.();
  return {
    timeoutMs: normalized,
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function throwIfTimedOut(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || new Error("provider request aborted");
}

function isTimeoutError(signal) {
  return Boolean(signal?.aborted);
}

function timeoutResult({ endpoint, request, traceId, started, timeoutMs, path }) {
  return {
    trace_id: traceId,
    endpoint_id: endpoint.id,
    status_code: 504,
    ok: false,
    path: path || "timeout",
    charged: false,
    estimated_usd: request.estimated_usd || request.estimatedUsd || null,
    amount_usd: null,
    currency: null,
    payment_reference: null,
    payment_network: null,
    payment_error: null,
    latency_ms: Math.min(Date.now() - started, timeoutMs),
    error: timeoutMessage(timeoutMs),
    body: null,
  };
}

function allowedHosts() {
  return new Set(
    (process.env.X402_ALLOWED_HOSTS || "api.exa.ai,x402.browserbase.com")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
}

function allowedChains() {
  const chains = new Set(
    (process.env.X402_ALLOWED_CHAINS || "eip155:8453,eip155:480,base")
      .split(",")
      .map((chain) => chain.trim())
      .filter(Boolean),
  );
  chains.add(process.env.X402_DEFAULT_CHAIN_ID || "eip155:8453");
  if (chains.has("eip155:8453")) chains.add("base");
  if (chains.has("base")) chains.add("eip155:8453");
  return chains;
}

function assertAllowedRequest(request) {
  const parsed = new URL(request.url);
  if (parsed.protocol !== "https:") throw new Error("provider URL must use https");
  if (!allowedHosts().has(parsed.hostname)) {
    throw new Error(`host is not allowlisted: ${parsed.hostname}`);
  }
}

function buildInit(request, signal = null) {
  const headers = new Headers(request.headers || {});
  const base: any = { method: request.method || "POST", headers };
  if (signal) base.signal = signal;
  if (request.json !== undefined) {
    headers.set("content-type", "application/json");
    return { ...base, body: JSON.stringify(request.json) };
  }
  return { ...base, method: request.method || "GET", body: request.body };
}

function usesAgentKitProofHeader(endpoint) {
  return endpoint?.agentkit_proof_header === true;
}

async function buildAgentKitProofHeader({ deps, account, request }) {
  if (typeof deps.formatSIWEMessage !== "function") {
    throw new Error("AgentKit SIWE formatter is unavailable");
  }
  const parsed = new URL(request.url);
  const now = new Date();
  const expiry = new Date(now.getTime() + 5 * 60 * 1000);
  const info = {
    domain: parsed.host,
    uri: request.url,
    version: "1",
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expirationTime: expiry.toISOString(),
    chainId: process.env.AGENTKIT_CHAIN_ID || "eip155:480",
    type: "eip191",
    statement: "Verify your agent is backed by a real human",
  };
  const message = deps.formatSIWEMessage(info, account.address);
  const signature = await account.signMessage({ message });
  return Buffer.from(JSON.stringify({ ...info, address: account.address, signature })).toString("base64");
}

async function buildPaymentInit({ endpoint, deps, account, request, signal = null }) {
  const init = buildInit(request, signal);
  if (!usesAgentKitProofHeader(endpoint)) return init;
  const headers = new Headers(init.headers);
  headers.set("agentkit", await buildAgentKitProofHeader({ deps, account, request }));
  return { ...init, headers };
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function maybeDecodePaymentHeader(header) {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(header);
    } catch {
      return { raw: header };
    }
  }
}

async function paymentRequiredFromResponse(response) {
  const header = response.headers.get("payment-required") || response.headers.get("PAYMENT-REQUIRED");
  const decoded = maybeDecodePaymentHeader(header);
  if (decoded) return decoded;
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function agentkitExtensionFromPaymentRequired(paymentRequired) {
  const extension = paymentRequired?.extensions?.agentkit;
  if (!extension || typeof extension !== "object") return null;
  return extension;
}

async function retryWithAgentKitHeader({ response, request, init, agentkit, baseFetch }) {
  const paymentRequired = await paymentRequiredFromResponse(response);
  const extension = agentkitExtensionFromPaymentRequired(paymentRequired);
  if (!extension || typeof agentkit?.createHeader !== "function") return response;
  const headers = new Headers(init.headers);
  headers.set("agentkit", await agentkit.createHeader(extension));
  return baseFetch(request.url, { ...init, headers });
}

function receiptFromResponse(response, events) {
  const header = response.headers.get("payment-response") || response.headers.get("x-payment-response");
  const decoded = maybeDecodePaymentHeader(header);
  const selected = [...events].reverse().find((event) => event.type === "x402_payment_selected") || {};
  const canUseSelectedPayment = response.ok;
  return {
    amount_usd: decoded?.amount_usd || decoded?.amountUsd || (canUseSelectedPayment ? selected.amount_usd : null) || null,
    currency: decoded?.currency || (canUseSelectedPayment && selected.amount_usd ? "USD" : null),
    payment_reference:
      decoded?.payment_reference ||
      decoded?.paymentReference ||
      decoded?.transaction ||
      decoded?.transactionHash ||
      decoded?.txHash ||
      null,
    payment_network: decoded?.network || decoded?.payment_network || selected.network || null,
    payment_error: null,
  };
}

function normalizePaymentMode(paymentMode, endpoint) {
  const resolved = paymentMode || endpoint?.defaultPaymentMode || "agentkit_first";
  if (!["agentkit_first", "agentkit_only", "x402_only"].includes(resolved)) {
    throw new Error(`unsupported payment mode: ${resolved}`);
  }
  return resolved;
}

function chargedFrom({ path, receipt, events, response }) {
  if (path === "agentkit") return false;
  return Boolean(
    receipt.payment_reference ||
      (response?.ok && events.some((event) => event.type === "x402_payment_selected")),
  );
}

async function loadPaymentDeps() {
  try {
    const [{ createAgentkitClient, formatSIWEMessage }, { x402Client }, { ExactEvmScheme, registerExactEvmScheme }, { wrapFetchWithPayment }, { privateKeyToAccount }] =
      await Promise.all([
        import("@worldcoin/agentkit"),
        import("@x402/core/client"),
        import("@x402/evm/exact/client"),
        import("@x402/fetch"),
        import("viem/accounts"),
      ]);
    return { createAgentkitClient, formatSIWEMessage, x402Client, ExactEvmScheme, registerExactEvmScheme, wrapFetchWithPayment, privateKeyToAccount };
  } catch (error) {
    throw Object.assign(
      new Error(
        "AgentKit/x402 dependencies are unavailable. Install router dependencies or run with ROUTER_DEV_MODE=true.",
      ),
      { cause: error, code: "missing_payment_dependencies" },
    );
  }
}

function walletPrivateKey() {
  let privateKey = process.env.AGENT_WALLET_PRIVATE_KEY || "";
  if (!privateKey) throw new Error("AGENT_WALLET_PRIVATE_KEY is required");
  if (!privateKey.startsWith("0x")) privateKey = `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("AGENT_WALLET_PRIVATE_KEY must be 0x plus 64 hex characters");
  }
  return privateKey;
}

function normalizeSignerAccount(account) {
  if (!account?.address || typeof account.signMessage !== "function") {
    throw new Error("payment signer must expose address and signMessage()");
  }
  return {
    ...account,
    signMessage: (payload) => {
      if (payload && typeof payload === "object" && "message" in payload) {
        return account.signMessage(payload);
      }
      return account.signMessage({ message: payload });
    },
    ...(typeof account.signTypedData === "function"
      ? {
          signTypedData: (payload) => account.signTypedData(payload),
        }
      : {}),
  };
}

function createAccount(deps, paymentSigner) {
  if (paymentSigner) return normalizeSignerAccount(paymentSigner);
  return deps.privateKeyToAccount(walletPrivateKey() as `0x${string}`);
}

function requirementAtomicAmount(requirement) {
  return requirement.amount ?? requirement.maxAmountRequired ?? "0";
}

function registerPaymentSchemes({ client, deps, account }) {
  if (typeof deps.registerExactEvmScheme === "function") {
    deps.registerExactEvmScheme(client, { signer: account });
    return;
  }
  client.register("eip155:*", new deps.ExactEvmScheme(account));
}

function createPaymentFetch({ x402Client, ExactEvmScheme, registerExactEvmScheme, wrapFetchWithPayment, account, maxUsd, events, baseFetch = fetch }) {
  const client = new x402Client();
  registerPaymentSchemes({ client, deps: { ExactEvmScheme, registerExactEvmScheme }, account });
  client.registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => allowedChains().has(requirement.network)),
  );
  client.registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => BigInt(requirementAtomicAmount(requirement)) <= decimalUsdToAtomic(maxUsd)),
  );
  client.onBeforePaymentCreation((context) => {
    events.push({
      type: "x402_payment_selected",
      network: context.selectedRequirements.network,
      amount_usd: atomicToUsdString(requirementAtomicAmount(context.selectedRequirements)),
      scheme: context.selectedRequirements.scheme,
    });
    return null;
  });
  return wrapFetchWithPayment(baseFetch, client);
}

async function executeDev({ endpoint, request, traceId }) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return {
    trace_id: traceId,
    endpoint_id: endpoint.id,
    status_code: 200,
    ok: true,
    path: "dev_stub",
    charged: false,
    estimated_usd: request.estimated_usd || request.estimatedUsd || null,
    amount_usd: null,
    currency: null,
    payment_reference: null,
    payment_network: null,
    payment_error: null,
    latency_ms: 5,
    body: {
      dev: true,
      endpoint_id: endpoint.id,
      request: request.json ?? null,
    },
  };
}

export async function executeEndpoint({ endpoint, request, maxUsd, traceId, paymentMode, paymentDeps, fetchImpl, paymentSigner, timeoutMs }: any) {
  const started = Date.now();
  if (process.env.ROUTER_DEV_MODE === "true") return executeDev({ endpoint, request, traceId });
  const timeout = createTimeoutController(timeoutMs);

  let response;
  let path;
  try {
    const paymentMaxUsd = effectivePaymentMaxUsd(maxUsd);
    const selectedPaymentMode = normalizePaymentMode(paymentMode, endpoint);
    assertAllowedRequest(request);
    throwIfTimedOut(timeout.signal);
    const deps = paymentDeps || (await loadPaymentDeps());
    throwIfTimedOut(timeout.signal);
    const account = createAccount(deps, paymentSigner);
    const events = [];
    const init = buildInit(request, timeout.signal);

    if (
      selectedPaymentMode === "x402_only" ||
      (usesAgentKitProofHeader(endpoint) && selectedPaymentMode !== "agentkit_only")
    ) {
      path = usesAgentKitProofHeader(endpoint) ? "agentkit_to_x402" : "x402";
      const fetchWithPayment = createPaymentFetch({
        ...deps,
        account,
        maxUsd: paymentMaxUsd,
        events,
        baseFetch: fetchImpl || fetch,
      });
      response = await fetchWithPayment(
        request.url,
        await buildPaymentInit({ endpoint, deps, account, request, signal: timeout.signal }),
      );
    } else {
      const baseFetch = fetchImpl || fetch;
      const agentkit = deps.createAgentkitClient({
        signer: {
          address: account.address,
          chainId: process.env.AGENTKIT_CHAIN_ID || "eip155:480",
          type: "eip191",
          signMessage: (message) => account.signMessage({ message }),
        },
      });

      path = "agentkit";
      response = await agentkit.fetch(request.url, init);
      if (response.status === 402) {
        response = await retryWithAgentKitHeader({
          response,
          request,
          init,
          agentkit,
          baseFetch,
        });
      }
      if (response.status === 402 && selectedPaymentMode !== "agentkit_only") {
        path = "agentkit_to_x402";
        const fetchWithPayment = createPaymentFetch({
          ...deps,
          account,
          maxUsd: paymentMaxUsd,
          events,
          baseFetch,
        });
        response = await fetchWithPayment(request.url, init);
      }
    }

    const receipt = receiptFromResponse(response, events);
    return {
      trace_id: traceId,
      endpoint_id: endpoint.id,
      status_code: response.status,
      ok: response.ok,
      path,
      charged: chargedFrom({ path, receipt, events, response }),
      estimated_usd: request.estimated_usd || request.estimatedUsd || null,
      ...receipt,
      latency_ms: Date.now() - started,
      body: await readResponseBody(response),
    };
  } catch (error) {
    if (timeout.timeoutMs && isTimeoutError(timeout.signal)) {
      return timeoutResult({
        endpoint,
        request,
        traceId,
        started,
        timeoutMs: timeout.timeoutMs,
        path,
      });
    }
    throw error;
  } finally {
    timeout.clear();
  }
}
