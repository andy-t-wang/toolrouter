"use client";

import { useEffect, useState } from "react";

type Handoff = {
  accessToken: string;
  errorCode: string;
  errorDescription: string;
  sessionId: string;
};

const emptyHandoff: Handoff = {
  accessToken: "",
  errorCode: "",
  errorDescription: "",
  sessionId: "",
};

export default function OnboardingConfirmPage() {
  const [handoff, setHandoff] = useState<Handoff>(emptyHandoff);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
    const next = {
      accessToken: hash.get("access_token") || "",
      errorCode: hash.get("error_code") || "",
      errorDescription: hash.get("error_description") || "",
      sessionId: url.searchParams.get("session") || "",
    };
    setHandoff(next);
    if (window.location.hash) {
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  }, []);

  const payload = JSON.stringify(
    {
      onboarding_session_id: handoff.sessionId,
      supabase_access_token: handoff.accessToken,
    },
    null,
    2,
  );
  const isReady = Boolean(handoff.sessionId && handoff.accessToken);
  const isLocalDev = handoff.accessToken === "dev_supabase_session";

  async function copyPayload() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(payload);
    setCopied(true);
  }

  return (
    <main style={{
      alignItems: "center",
      background:
        "radial-gradient(circle at top left, #d9f99d 0, transparent 28rem), linear-gradient(135deg, #082f49, #0f172a 55%, #111827)",
      color: "#f8fafc",
      display: "flex",
      minHeight: "100vh",
      padding: "32px",
    }}>
      <section style={{
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(226, 232, 240, 0.18)",
        borderRadius: "28px",
        boxShadow: "0 30px 100px rgba(0, 0, 0, 0.45)",
        margin: "0 auto",
        maxWidth: "760px",
        padding: "36px",
      }}>
        <p style={{
          color: "#bef264",
          fontSize: "13px",
          fontWeight: 800,
          letterSpacing: "0.18em",
          margin: "0 0 14px",
          textTransform: "uppercase",
        }}>
          ToolRouter onboarding
        </p>
        <h1 style={{
          fontSize: "clamp(36px, 8vw, 72px)",
          letterSpacing: "-0.07em",
          lineHeight: 0.9,
          margin: "0 0 18px",
        }}>
          Authentication complete.
        </h1>

        {handoff.errorCode ? (
          <p style={{ color: "#fecaca", fontSize: "18px", lineHeight: 1.6 }}>
            The login link could not be verified: {handoff.errorDescription || handoff.errorCode}.
          </p>
        ) : (
          <p style={{ color: "#cbd5e1", fontSize: "18px", lineHeight: 1.6 }}>
            Return to your agent. It can now attach this authenticated session to the onboarding flow and continue without a UI detour.
          </p>
        )}

        {isReady ? (
          <>
            <div style={{
              background: "rgba(2, 6, 23, 0.72)",
              border: "1px solid rgba(148, 163, 184, 0.24)",
              borderRadius: "18px",
              marginTop: "24px",
              overflow: "hidden",
            }}>
              <div style={{
                borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
                color: "#94a3b8",
                display: "flex",
                fontSize: "13px",
                justifyContent: "space-between",
                padding: "12px 16px",
              }}>
                <span>Agent handoff payload</span>
                <span>{isLocalDev ? "local dev session" : "Supabase session"}</span>
              </div>
              <pre style={{
                color: "#e2e8f0",
                fontSize: "13px",
                lineHeight: 1.5,
                margin: 0,
                overflowX: "auto",
                padding: "16px",
                whiteSpace: "pre-wrap",
              }}>
                {payload}
              </pre>
            </div>
            <button
              onClick={copyPayload}
              style={{
                background: "#bef264",
                border: 0,
                borderRadius: "999px",
                color: "#0f172a",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 800,
                marginTop: "20px",
                padding: "12px 18px",
              }}
              type="button"
            >
              {copied ? "Copied" : "Copy handoff payload"}
            </button>
          </>
        ) : handoff.errorCode ? null : (
          <p style={{ color: "#94a3b8", marginTop: "24px" }}>
            Waiting for the authentication payload...
          </p>
        )}
      </section>
    </main>
  );
}
