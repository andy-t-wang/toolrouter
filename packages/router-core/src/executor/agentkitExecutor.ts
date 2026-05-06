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
    (process.env.X402_ALLOWED_CHAINS || "eip155:8453,eip155:480")
      .split(",")
      .map((chain) => chain.trim())
      .filter(Boolean),
  );
  chains.add(process.env.X402_DEFAULT_CHAIN_ID || "eip155:8453");
  return chains;
}

function assertAllowedRequest(request) {
  const parsed = new URL(request.url);
  if (parsed.protocol !== "https:") throw new Error("provider URL must use https");
  if (!allowedHosts().has(parsed.hostname)) {
    throw new Error(`host is not allowlisted: ${parsed.hostname}`);
  }
}

function buildInit(request) {
  const headers = new Headers(request.headers || {});
  if (request.json !== undefined) {
    headers.set("content-type", "application/json");
    return { method: request.method || "POST", headers, body: JSON.stringify(request.json) };
  }
  return { method: request.method || "GET", headers, body: request.body };
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

function receiptFromResponse(response, events) {
  const header = response.headers.get("payment-response") || response.headers.get("x-payment-response");
  const decoded = maybeDecodePaymentHeader(header);
  const selected = [...events].reverse().find((event) => event.type === "x402_payment_selected") || {};
  return {
    amount_usd: decoded?.amount_usd || decoded?.amountUsd || selected.amount_usd || null,
    currency: decoded?.currency || (selected.amount_usd ? "USD" : null),
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
  if (!["agentkit_first", "x402_only"].includes(resolved)) {
    throw new Error(`unsupported payment mode: ${resolved}`);
  }
  return resolved;
}

function chargedFrom({ path, receipt, events }) {
  if (path === "agentkit") return false;
  return Boolean(
    receipt.payment_reference ||
      receipt.amount_usd ||
      events.some((event) => event.type === "x402_payment_selected"),
  );
}

async function loadPaymentDeps() {
  try {
    const [{ createAgentkitClient }, { x402Client }, { ExactEvmScheme }, { wrapFetchWithPayment }, { privateKeyToAccount }] =
      await Promise.all([
        import("@worldcoin/agentkit"),
        import("@x402/core/client"),
        import("@x402/evm/exact/client"),
        import("@x402/fetch"),
        import("viem/accounts"),
      ]);
    return { createAgentkitClient, x402Client, ExactEvmScheme, wrapFetchWithPayment, privateKeyToAccount };
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
  };
}

function createAccount(deps, paymentSigner) {
  if (paymentSigner) return normalizeSignerAccount(paymentSigner);
  return deps.privateKeyToAccount(walletPrivateKey() as `0x${string}`);
}

function createPaymentFetch({ x402Client, ExactEvmScheme, wrapFetchWithPayment, account, maxUsd, events, baseFetch = fetch }) {
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
  client.registerPolicy((version, requirements) =>
    requirements.filter((requirement) => allowedChains().has(requirement.network)),
  );
  client.registerPolicy((version, requirements) =>
    requirements.filter((requirement) => BigInt(requirement.amount) <= decimalUsdToAtomic(maxUsd)),
  );
  client.onBeforePaymentCreation((context) => {
    events.push({
      type: "x402_payment_selected",
      network: context.selectedRequirements.network,
      amount_usd: atomicToUsdString(context.selectedRequirements.amount),
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

export async function executeEndpoint({ endpoint, request, maxUsd, traceId, paymentMode, paymentDeps, fetchImpl, paymentSigner }: any) {
  const started = Date.now();
  if (process.env.ROUTER_DEV_MODE === "true") return executeDev({ endpoint, request, traceId });

  const paymentMaxUsd = effectivePaymentMaxUsd(maxUsd);
  const selectedPaymentMode = normalizePaymentMode(paymentMode, endpoint);
  assertAllowedRequest(request);
  const deps = paymentDeps || (await loadPaymentDeps());
  const account = createAccount(deps, paymentSigner);
  const events = [];
  const init = buildInit(request);
  let response;
  let path;

  if (selectedPaymentMode === "x402_only") {
    const fetchWithPayment = createPaymentFetch({
      ...deps,
      account,
      maxUsd: paymentMaxUsd,
      events,
      baseFetch: fetchImpl || fetch,
    });
    response = await fetchWithPayment(request.url, init);
    path = "x402";
  } else {
    const agentkit = deps.createAgentkitClient({
      signer: {
        address: account.address,
        chainId: process.env.AGENTKIT_CHAIN_ID || "eip155:480",
        type: "eip191",
        signMessage: (message) => account.signMessage({ message }),
      },
    });

    response = await agentkit.fetch(request.url, init);
    path = "agentkit";
    if (response.status === 402) {
      const fetchWithPayment = createPaymentFetch({
        ...deps,
        account,
        maxUsd: paymentMaxUsd,
        events,
        baseFetch: fetchImpl || fetch,
      });
      response = await fetchWithPayment(request.url, init);
      path = "agentkit_to_x402";
    }
  }

  const receipt = receiptFromResponse(response, events);
  return {
    trace_id: traceId,
    endpoint_id: endpoint.id,
    status_code: response.status,
    ok: response.ok,
    path,
    charged: chargedFrom({ path, receipt, events }),
    estimated_usd: request.estimated_usd || request.estimatedUsd || null,
    ...receipt,
    latency_ms: Date.now() - started,
    body: await readResponseBody(response),
  };
}
