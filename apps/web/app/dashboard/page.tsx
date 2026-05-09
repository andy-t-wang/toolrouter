"use client";

import { Agentation } from "agentation";
import { createClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { computeDashboardMetrics, paidAmount } from "../dashboard-metrics.ts";

const apiBase = process.env.NEXT_PUBLIC_TOOLROUTER_API_URL || "";
const appBase = (process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL || "").replace(/\/$/u, "");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const devAuthEnabled = process.env.NEXT_PUBLIC_TOOLROUTER_DEV_AUTH === "true";
const unverifiedAgentKitStatus = ["Not", "Verified"].join(" ");
const pendingTopUpStatuses = new Set([
  "checkout_pending",
  "funding_pending",
  "funding_failed",
]);
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

function allowLocalDevSession() {
  if (typeof window === "undefined") return false;
  const localHost =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";
  return localHost && (!supabase || devAuthEnabled);
}

async function sessionFromUrlHash() {
  if (!supabase || typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return "";
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}#dashboard`,
  );
  return data.session?.access_token || accessToken;
}

function Icon({
  name,
}: {
  name: "home" | "key" | "onboard" | "copy" | "wallet" | "check";
}) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v10h14V10" />
      </>
    ),
    key: (
      <>
        <circle cx="9" cy="12" r="3.5" />
        <path d="M12.5 12H21" />
        <path d="M18 10v4M21 10v4" />
      </>
    ),
    onboard: (
      <>
        <path d="M12 4v8" />
        <path d="M8 8l4-4 4 4" />
        <rect x="4" y="14" width="16" height="6" rx="1" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="1.5" />
        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      </>
    ),
    check: <path d="M5 12.5l4.25 4L19 7" />,
    wallet: (
      <>
        <path d="M4 7h14a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z" />
        <path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" />
        <path d="M5 7V5a1 1 0 0 1 1-1h11" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `$${number.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ledgerTypeLabel(type: unknown) {
  const labels: Record<string, string> = {
    top_up_settled: "Credits added",
    top_up_failed: "Top-up failed",
    reserve: "Usage started",
    capture: "Usage charged",
    release: "Credits returned",
  };
  const normalized = String(type || "").trim();
  if (!normalized) return "-";
  if (labels[normalized]) return labels[normalized];
  return normalized
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function sourceLabel(source: unknown) {
  const labels: Record<string, string> = {
    stripe: "Stripe",
    toolrouter: "ToolRouter",
    router: "ToolRouter",
    x402: "x402",
    agentkit: "AgentKit",
  };
  const normalized = String(source || "").trim();
  if (!normalized) return "-";
  const key = normalized.toLowerCase();
  return labels[key] || normalized;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function monthStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function keyStatus(active: boolean) {
  return (
    <span className={`key-status ${active ? "active" : "disabled"}`}>
      <span className="key-status-dot" />
      {active ? "Active" : "Disabled"}
    </span>
  );
}

function pathChip(path: string, charged: boolean) {
  const route = String(path || "unknown").toLowerCase();
  if (route === "agentkit")
    return <span className="chip free">agentkit · free</span>;
  if (route === "x402")
    return <span className="chip accent">x402{charged ? " · paid" : ""}</span>;
  if (route === "agentkit_to_x402")
    return <span className="chip accent">agentkit to x402 · paid</span>;
  return <span className="chip neutral">{route}</span>;
}

function valueChip(row: any) {
  const label =
    row.agentkit_value_label ||
    (String(row.endpoint_id || "").startsWith("browserbase.")
      ? "AgentKit-Access"
      : "AgentKit-Free Trial");
  const normalized = String(row.agentkit_value_type || label).toLowerCase();
  const cls = normalized.includes("access")
    ? "accent"
    : normalized.includes("discount")
      ? "warn"
      : "free";
  return <span className={`chip ${cls}`}>{label}</span>;
}

function humanBadge() {
  return (
    <span className="human-badge" aria-label="World ID verified human">
      <span className="human-mark" aria-hidden="true" />
      <span>human</span>
    </span>
  );
}

function maskKeyId(value: string) {
  if (!value) return "key_...";
  if (value === "key_dev") return "key_dev";
  const compact = value.replace(/^key_/, "");
  return `key_${compact.slice(0, 4)}...${compact.slice(-2)}`;
}

async function copyText(value: string) {
  if (!navigator.clipboard) {
    throw new Error("Clipboard access is not available in this browser.");
  }
  await navigator.clipboard.writeText(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch(
  path: string,
  { token, apiKey, ...options }: any = {},
) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message || `Request failed: ${response.status}`,
    );
  return body;
}

export default function DashboardPage() {
  const [page, setPage] = useState("dashboard");
  const [email, setEmail] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [banner, setBanner] = useState("");
  const [requests, setRequests] = useState<any[]>([]);
  const [monthRequests, setMonthRequests] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [topUps, setTopUps] = useState<any[]>([]);
  const [callerId, setCallerId] = useState("default");
  const [revealedKey, setRevealedKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("5");
  const [verificationChecking, setVerificationChecking] = useState(false);
  const [registrationState, setRegistrationState] = useState("idle");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [registrationError, setRegistrationError] = useState("");

  useEffect(() => {
    const syncPageFromHash = () => {
      const hash = window.location.hash.replace(/^#/u, "");
      if (
        hash === "dashboard" ||
        hash === "keys" ||
        hash === "billing" ||
        hash === "quickstart"
      )
        setPage(hash);
    };
    syncPageFromHash();
    window.addEventListener("hashchange", syncPageFromHash);
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  const keyStats = useMemo(() => {
    const byKey = new Map<string, any[]>();
    for (const row of requests) {
      if (row.api_key_id)
        byKey.set(row.api_key_id, [...(byKey.get(row.api_key_id) || []), row]);
    }
    return byKey;
  }, [requests]);

  const dashboardMetrics = useMemo(() => {
    const rows = monthRequests.length ? monthRequests : requests;
    return computeDashboardMetrics(rows);
  }, [monthRequests, requests]);
  const agentKitVerified = Boolean(balance?.agentkit_verification?.verified);
  const agentKitCheckMeta = [
    balance?.agentkit_verification?.last_checked_at
      ? `Last checked ${formatDate(balance.agentkit_verification.last_checked_at)}`
      : "",
    balance?.agentkit_verification?.error &&
    balance.agentkit_verification.error !== unverifiedAgentKitStatus
      ? balance.agentkit_verification.error
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const registrationBusy = registrationState !== "idle";
  const registrationButtonLabel =
    registrationState === "creating"
      ? "Preparing"
      : registrationState === "waiting"
        ? "Waiting for World App"
        : registrationState === "submitting"
          ? "Finishing"
          : "Verify with AgentKit";
  const pendingTopUps = topUps.filter((topUp) =>
    pendingTopUpStatuses.has(String(topUp.status || "")),
  );

  async function refresh(token = sessionToken) {
    if (!token) return;
    const [
      requestBody,
      monthRequestBody,
      keyBody,
      balanceBody,
      ledgerBody,
      topUpBody,
    ] =
      await Promise.all([
        jsonFetch("/v1/dashboard/requests?limit=100", { token }),
        jsonFetch(
          `/v1/dashboard/requests?limit=500&since=${encodeURIComponent(monthStartIso())}`,
          { token },
        ),
        jsonFetch("/v1/api-keys", { token }),
        jsonFetch("/v1/balance", { token }),
        jsonFetch("/v1/ledger?limit=50", { token }),
        jsonFetch("/v1/top-ups?limit=10", { token }),
      ]);
    setRequests(requestBody.requests || []);
    setMonthRequests(monthRequestBody.requests || []);
    setKeys(keyBody.api_keys || []);
    setBalance(balanceBody.balance || null);
    setLedger(ledgerBody.entries || []);
    setTopUps(topUpBody.top_ups || []);
  }

  useEffect(() => {
    if (!supabase) {
      setSessionToken("dev_supabase_session");
      refresh("dev_supabase_session").catch((error) =>
        setBanner(error.message),
      );
      return;
    }
    sessionFromUrlHash()
      .then((urlToken) => {
        if (urlToken) {
          setSessionToken(urlToken);
          refresh(urlToken).catch((error) => setBanner(error.message));
          return;
        }
        supabase.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token || "";
          setSessionToken(token);
          if (token) refresh(token).catch((error) => setBanner(error.message));
          else if (allowLocalDevSession()) {
            setSessionToken("dev_supabase_session");
            refresh("dev_supabase_session").catch((error) =>
              setBanner(error.message),
            );
          }
        });
      })
      .catch((error) => setBanner(error.message));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token || "";
      if (token) {
        setSessionToken(token);
        refresh(token).catch((error) => setBanner(error.message));
      } else if (allowLocalDevSession()) {
        setSessionToken("dev_supabase_session");
        refresh("dev_supabase_session").catch((error) =>
          setBanner(error.message),
        );
      } else {
        setSessionToken("");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn() {
    if (allowLocalDevSession()) {
      setSessionToken("dev_supabase_session");
      await refresh("dev_supabase_session");
      return;
    }
    if (!supabase) {
      setSessionToken("dev_supabase_session");
      await refresh("dev_supabase_session");
      return;
    }
    const origin =
      appBase ||
      (typeof window === "undefined" ? "" : window.location.origin);
    const redirectTo = origin ? `${origin}/dashboard` : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (error) throw error;
    setBanner("Check your email for a login link.");
  }

  async function createKey() {
    const body = await jsonFetch("/v1/api-keys", {
      token: sessionToken,
      method: "POST",
      body: JSON.stringify({ caller_id: callerId }),
    });
    setRevealedKey(body.api_key);
    setCopiedKey(false);
    await refresh();
  }

  async function copyRevealedKey() {
    await copyText(revealedKey);
    setCopiedKey(true);
  }

  async function disableKey(id: string) {
    await jsonFetch(`/v1/api-keys/${encodeURIComponent(id)}`, {
      token: sessionToken,
      method: "DELETE",
    });
    await refresh();
  }

  async function createTopUp() {
    const body = await jsonFetch("/v1/top-ups", {
      token: sessionToken,
      method: "POST",
      body: JSON.stringify({ amountUsd: topUpAmount }),
    });
    const url = body.top_up?.checkout_url;
    if (body.top_up) setTopUps((current) => [body.top_up, ...current]);
    setBanner(
      url
        ? "Opening secure checkout..."
        : "Credit top-up created. Refresh shortly to see the latest status.",
    );
    if (url && typeof window !== "undefined") {
      window.location.assign(url);
    }
    await refresh();
  }

  async function checkAgentKitAccount() {
    setVerificationChecking(true);
    try {
      const body = await jsonFetch("/v1/agentkit/account-verification", {
        token: sessionToken,
        method: "POST",
        body: JSON.stringify({}),
      });
      setBalance((current: any) => ({
        ...(current || {}),
        agentkit_verification: body.agentkit_verification,
      }));
    } finally {
      setVerificationChecking(false);
    }
  }

  async function registerAgentKitAccount() {
    setRegistrationState("creating");
    setRegistrationUrl("");
    setRegistrationError("");
    try {
      const prepared = await jsonFetch("/v1/agentkit/registration", {
        token: sessionToken,
        method: "POST",
        body: JSON.stringify({}),
      });
      const { createWorldBridgeStore } = await import("@worldcoin/idkit-core");
      const worldID = createWorldBridgeStore();
      await worldID.getState().createClient({
        app_id: prepared.registration.app_id,
        action: prepared.registration.action,
        signal: prepared.registration.signal,
        verification_level: prepared.registration.verification_level || "orb",
      });
      const connectorURI = worldID.getState().connectorURI || "";
      setRegistrationUrl(connectorURI);
      setRegistrationState("waiting");

      const deadline =
        Date.now() + (prepared.registration.expires_in_seconds || 300) * 1000;
      while (Date.now() < deadline) {
        await worldID.getState().pollForUpdates();
        const state = worldID.getState();
        if (state.errorCode) {
          throw new Error(`World App verification failed: ${state.errorCode}`);
        }
        if (state.result) {
          setRegistrationState("submitting");
          const body = await jsonFetch("/v1/agentkit/registration/complete", {
            token: sessionToken,
            method: "POST",
            body: JSON.stringify({
              nonce: prepared.registration.nonce,
              result: state.result,
            }),
          });
          setBalance((current: any) => ({
            ...(current || {}),
            agentkit_verification: body.agentkit_verification,
          }));
          setRegistrationUrl("");
          setBanner("AgentKit verification complete.");
          return;
        }
        await sleep(1000);
      }
      throw new Error("World App verification timed out. Start again when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRegistrationError(message);
      setBanner(message);
    } finally {
      setRegistrationState("idle");
    }
  }

  if (!sessionToken) {
    return (
      <>
        <main className="auth-layout">
          <section className="card auth-panel">
            <div className="top-brand">
              <span className="brand-mark" aria-hidden="true" />
              <span>ToolRouter</span>
            </div>
            <h1 className="display">Sign in or Create Account</h1>

            <input
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <button
              className="button primary"
              type="button"
              onClick={() =>
                signIn().catch((error) => setBanner(error.message))
              }
            >
              Send magic link
            </button>
            {banner ? <div className="banner">{banner}</div> : null}
          </section>
        </main>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </>
    );
  }

  return (
    <>
      <div className="app-shell">
        <header className="topnav">
          <div className="topnav-inner">
            <a
              className="top-brand"
              href="#dashboard"
              onClick={() => setPage("dashboard")}
            >
              <span className="brand-mark" aria-hidden="true" />
              <span>ToolRouter</span>
            </a>
            <div className="session-actions">
              <span className="pill">
                <span className="dot live" />
                99.4% / 24h
              </span>
              <button
                className="button ghost compact"
                type="button"
                onClick={() =>
                  refresh().catch((error) => setBanner(error.message))
                }
              >
                Refresh
              </button>
              <div className="avatar">JS</div>
            </div>
          </div>
        </header>

        <div className="dash">
          <aside className="side">
            <nav className="side-links">
              {["dashboard", "keys", "billing", "quickstart"].map((item) => (
                <a
                  key={item}
                  className={page === item ? "active" : ""}
                  href={`#${item}`}
                  onClick={() => setPage(item)}
                >
                  {item === "dashboard" ? (
                    <Icon name="home" />
                  ) : item === "keys" ? (
                    <Icon name="key" />
                  ) : item === "billing" ? (
                    <Icon name="wallet" />
                  ) : (
                    <Icon name="onboard" />
                  )}
                  <span>
                    {item === "dashboard"
                      ? "Dashboard"
                      : item === "keys"
                        ? "API keys"
                        : item === "billing"
                          ? "Billing"
                          : "Quickstart"}
                  </span>
                </a>
              ))}
            </nav>
            <div className="side-status">
              <span>Status</span>
              <strong>
                <span className="dot good" />
                All systems normal
              </strong>
            </div>
          </aside>

          <main className="main">
            {banner ? <div className="banner">{banner}</div> : null}

            {page === "dashboard" ? (
              <section className="dashboard-stack">
                <div className="page-h">
                  <div>
                    <h1 className="display">Dashboard</h1>
                    <p className="sub">
                      Last 100 requests · refreshed just now
                    </p>
                  </div>
                  <div className="page-actions">
                    <span className="pill">
                      <span className="dot live" /> live
                    </span>
                    <button className="button ghost compact" type="button">
                      This month ▾
                    </button>
                  </div>
                </div>

                <div className="stats-grid">
                  <section className="card stat-card">
                    <span className="metric-label">Requests</span>
                    <strong className="metric-value">
                      {dashboardMetrics.totalRequests.toLocaleString()}
                    </strong>
                    <span className="metric-hint">
                      {dashboardMetrics.avgPerDay.toLocaleString()} avg / day
                    </span>
                  </section>
                  <section className="card stat-card">
                    <span className="metric-label">Total paid</span>
                    <strong className="metric-value">
                      {money(dashboardMetrics.totalPaid)}
                    </strong>
                    <span className="metric-hint">
                      {money(dashboardMetrics.avgPaidPerRequest)} per request
                      avg
                    </span>
                  </section>
                  <section className="card stat-card">
                    <span className="metric-label">% using AgentKit</span>
                    <strong className="metric-value">
                      {dashboardMetrics.agentKitPercent.toFixed(1)}%
                    </strong>
                    <span className="metric-hint">
                      {dashboardMetrics.agentKitCount.toLocaleString()} of{" "}
                      {dashboardMetrics.totalRequests.toLocaleString()} on free
                      path
                    </span>
                  </section>
                </div>

                <section className="card">
                  <div className="hd">
                    <h2>AgentKit vs x402 — this month</h2>
                  </div>
                  <div className="bd">
                    <div className="free-paid-summary">
                      <div className="split-stats">
                        <div>
                          <span className="metric-label">AgentKit (free)</span>
                          <strong className="split-count">
                            {dashboardMetrics.agentKitCount.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <span className="metric-label">x402 (paid)</span>
                          <strong className="split-count">
                            {dashboardMetrics.x402Count.toLocaleString()}
                          </strong>
                        </div>
                      </div>
                      <span className="muted mono num">
                        {dashboardMetrics.agentKitShare.toFixed(1)}% free
                      </span>
                    </div>
                    <div
                      className={`free-paid-bar ${dashboardMetrics.trackedPathCount ? "" : "empty"}`}
                      aria-label="AgentKit versus x402 usage"
                    >
                      <span
                        className="free-segment"
                        style={{ width: `${dashboardMetrics.agentKitShare}%` }}
                      />
                      <span className="paid-segment" />
                    </div>
                  </div>
                </section>

                <section className="card recent-calls-card">
                  <div className="hd">
                    <h2>Recent calls</h2>
                    <button className="button ghost compact" type="button">
                      Filters
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table className="tbl recent-calls-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Endpoint</th>
                          <th>Path</th>
                          <th>Value</th>
                          <th className="num">Status</th>
                          <th className="num">Latency</th>
                          <th className="num">Charge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.length ? (
                          requests.map((row) => (
                            <tr key={row.id}>
                              <td className="mono muted">
                                {formatTime(row.ts)}
                              </td>
                              <td className="mono">{row.endpoint_id}</td>
                              <td>{pathChip(row.path, row.charged)}</td>
                              <td>{valueChip(row)}</td>
                              <td
                                className={`mono num ${Number(row.status_code) >= 400 ? "bad-text" : ""}`}
                              >
                                {row.status_code || "-"}
                              </td>
                              <td className="mono num muted">
                                {row.latency_ms ?? "-"} ms
                              </td>
                              <td className="mono num">
                                {paidAmount(row) > 0
                                  ? money(paidAmount(row))
                                  : "-"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7}>No requests yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>
            ) : null}

            {page === "billing" ? (
              <section className="dashboard-stack">
                <div className="page-h">
                  <div>
                    <h1 className="display">Billing</h1>
                    <p className="sub">USD credits for ToolRouter usage.</p>
                  </div>
                  <button
                    className="button ghost compact"
                    type="button"
                    onClick={() =>
                      refresh().catch((error) => setBanner(error.message))
                    }
                  >
                    Refresh
                  </button>
                </div>

                <div className="billing-grid">
                  <section className="card balance-card">
                    <div className="hd">
                      <h2>Credit balance</h2>
                      {agentKitVerified ? humanBadge() : null}
                    </div>
                    <div className="bd balance-body">
                      <div>
                        <span className="metric-label">Available</span>
                        <strong className="metric-value">
                          {money(balance?.available_usd || 0)}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="card topup-card">
                    <div className="hd">
                      <h2>Add credits</h2>
                    </div>
                    <div className="bd topup-form">
                      <label className="metric-label" htmlFor="top-up-amount">
                        Amount
                      </label>
                      <div className="money-input-row">
                        <span>$</span>
                        <input
                          id="top-up-amount"
                          className="input mono"
                          inputMode="decimal"
                          max="5"
                          min="0.01"
                          value={topUpAmount}
                          onChange={(event) =>
                            setTopUpAmount(event.target.value)
                          }
                        />
                      </div>
                      <button
                        className="button primary"
                        type="button"
                        onClick={() =>
                          createTopUp().catch((error) =>
                            setBanner(error.message),
                          )
                        }
                      >
                        Add Credits
                      </button>
                    </div>
                  </section>
                </div>

                {pendingTopUps.length ? (
                  <section className="billing-notice">
                    <div>
                      <strong>
                        Credits usually appear within 30-90 seconds after
                        checkout.
                      </strong>
                      <p>
                        If account funding is delayed, the payment stays recorded
                        and ToolRouter retries settlement. Credits are only made
                        available after settlement succeeds.
                      </p>
                    </div>
                  </section>
                ) : null}

                {balance && !agentKitVerified ? (
                  <section className="card verification-card">
                    <div className="hd">
                      <h2>Account Verification</h2>
                    </div>
                    <div className="bd verification-body">
                      <div>
                        <p className="muted">
                          Verify this account with AgentKit through World App.
                        </p>
                        {agentKitCheckMeta ? (
                          <span className="metric-hint">
                            {agentKitCheckMeta}
                          </span>
                        ) : null}
                        {registrationUrl ? (
                          <a
                            className="verification-link"
                            href={registrationUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open World App verification
                          </a>
                        ) : null}
                        {registrationError ? (
                          <span className="metric-hint error-text">
                            {registrationError}
                          </span>
                        ) : null}
                      </div>
                      <div className="verification-actions">
                        <button
                          className="button primary"
                          type="button"
                          disabled={registrationBusy}
                          onClick={() =>
                            registerAgentKitAccount().catch((error) =>
                              setBanner(error.message),
                            )
                          }
                        >
                          {registrationButtonLabel}
                        </button>
                        <button
                          className="button ghost"
                          type="button"
                          disabled={verificationChecking || registrationBusy}
                          onClick={() =>
                            checkAgentKitAccount().catch((error) =>
                              setBanner(error.message),
                            )
                          }
                        >
                          {verificationChecking ? "Checking" : "Check status"}
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="card">
                  <div className="hd">
                    <h2>Credit ledger</h2>
                  </div>
                  <div className="table-scroll">
                    <table className="tbl ledger-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Source</th>
                          <th>Reference</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.length ? (
                          ledger.map((entry) => (
                            <tr key={entry.id}>
                              <td className="mono muted">
                                {formatTime(entry.ts)}
                              </td>
                              <td>{ledgerTypeLabel(entry.type)}</td>
                              <td>{sourceLabel(entry.source)}</td>
                              <td className="mono muted clip">
                                {entry.reference_id || "-"}
                              </td>
                              <td className="mono num">
                                {money(entry.amount_usd)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>No credit activity yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>
            ) : null}

            {page === "keys" ? (
              <section className="dashboard-stack">
                <div className="page-h">
                  <div>
                    <h1 className="display">API keys</h1>
                    <p className="sub">
                      {keys.length} keys ·{" "}
                      {keys.filter((key) => !key.disabled_at).length} active
                    </p>
                  </div>
                  <div className="key-actions">
                    <label className="sr-only" htmlFor="caller-id">
                      Caller ID
                    </label>
                    <input
                      id="caller-id"
                      className="input caller-input mono"
                      value={callerId}
                      onChange={(event) => setCallerId(event.target.value)}
                      placeholder="caller_id"
                    />
                    <button
                      className="button primary compact"
                      type="button"
                      onClick={() =>
                        createKey().catch((error) => setBanner(error.message))
                      }
                    >
                      <Icon name="key" />
                      Create key
                    </button>
                  </div>
                </div>
                {revealedKey ? (
                  <section className="card key-reveal">
                    <div className="hd">
                      <h2>New API key</h2>
                      <span className="muted">Shown Once</span>
                    </div>
                    <div className="bd">
                      <p className="muted">
                        We hash the key on save. If you lose it, disable it and
                        mint a new one.
                      </p>
                      <div className="key-token-row">
                        <code className="key-token">{revealedKey}</code>
                        <button
                          className={`button ghost compact copy-key-button${copiedKey ? " copied" : ""}`}
                          type="button"
                          onClick={() =>
                            copyRevealedKey().catch((error) =>
                              setBanner(error.message),
                            )
                          }
                          aria-live="polite"
                        >
                          <Icon name={copiedKey ? "check" : "copy"} />
                          {copiedKey ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
                <section className="card">
                  <div className="table-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Caller</th>
                          <th>Created</th>
                          <th>Last used</th>
                          <th className="num">Requests</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.length ? (
                          keys.map((key) => {
                            const rows = keyStats.get(key.id) || [];
                            const active = !key.disabled_at;
                            return (
                              <tr key={key.id}>
                                <td className="mono">{maskKeyId(key.id)}</td>
                                <td className="mono">{key.caller_id}</td>
                                <td className="muted">
                                  {formatDate(key.created_at)}
                                </td>
                                <td className="muted">
                                  {formatDate(rows[0]?.ts)}
                                </td>
                                <td className="mono num">
                                  {rows.length.toLocaleString()}
                                </td>
                                <td>{keyStatus(active)}</td>
                                <td className="row-action">
                                  {active ? (
                                    <button
                                      className="link-button"
                                      type="button"
                                      onClick={() =>
                                        disableKey(key.id).catch((error) =>
                                          setBanner(error.message),
                                        )
                                      }
                                    >
                                      Disable
                                    </button>
                                  ) : (
                                    <span className="muted">Disabled</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7}>No API keys.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>
            ) : null}

            {page === "quickstart" ? (
              <section className="dashboard-stack">
                <div className="page-h">
                  <div>
                    <h1 className="display">Quickstart</h1>
                    <p className="sub">
                      Create one key, connect MCP, inspect the trace.
                    </p>
                  </div>
                </div>
                <section className="card quickstart-card">
                  <div className="hd">
                    <h2>Use ToolRouter from an agent</h2>
                    <a className="link-button" href="/setup">
                      Full setup
                    </a>
                  </div>
                  <pre className="code-block">
                    <code>{`const response = await fetch("${apiBase}/v1/requests", {
  method: "POST",
  headers: {
    authorization: \`Bearer \${process.env.TOOLROUTER_API_KEY}\`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    endpoint_id: "exa.search",
    input: { query: "AgentKit examples", num_results: 5 },
    maxUsd: "0.05"
  })
});

const trace = await response.json();
console.log(trace.path);`}</code>
                  </pre>
                </section>
                <section className="card quickstart-card">
                  <div className="hd">
                    <h2>MCP first query</h2>
                  </div>
                  <pre className="code-block">
                    <code>{`Use ToolRouter to search for the top sushi places in SF.
Call exa_search with:
{
  "query": "top sushi places in San Francisco",
  "maxUsd": "0.01"
}`}</code>
                  </pre>
                </section>
              </section>
            ) : null}
          </main>
        </div>
      </div>
      {process.env.NODE_ENV === "development" && <Agentation />}
    </>
  );
}
