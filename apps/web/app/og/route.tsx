import { ImageResponse } from "next/og.js";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

const routeCards: Record<string, { eyebrow: string; title: string; description: string; accent: string }> = {
  "/": {
    eyebrow: "AgentKit + x402 tool routing",
    title: "Tools your agent can actually trust.",
    description:
      "ToolRouter is an MCP server your agent connects to once. Every endpoint is verified, paid through AgentKit, and traced end-to-end.",
    accent: "Live endpoint proof",
  },
  "/setup": {
    eyebrow: "Agent setup",
    title: "Connect any MCP-capable agent.",
    description:
      "Use one ToolRouter API key with the MCP adapter. Hermes, OpenClaw, OpenJarvis, ZeroClaw, Codex, Claude Code, Cursor, and other MCP clients can call the same named tools.",
    accent: "MCP-ready",
  },
  "/docs": {
    eyebrow: "Endpoint docs",
    title: "Ship endpoints agents can trust.",
    description:
      "ToolRouter lists endpoints that behave predictably through AgentKit first, x402 fallback, typed input validation, capped health probes, and traceable payment metadata.",
    accent: "Provider-ready",
  },
};

function routeCard(path: string | null) {
  return routeCards[path || ""] || routeCards["/"];
}

function ToolRouterMark() {
  return (
    <svg height="44" viewBox="0 0 80 64" width="55">
      <g
        fill="none"
        stroke="#0a0a0a"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
        transform="translate(8 7)"
      >
        <circle cx="6" cy="14" fill="#0a0a0a" r="5" />
        <circle cx="6" cy="32" fill="#0a0a0a" r="5" />
        <circle cx="6" cy="50" fill="#0a0a0a" r="5" />
        <path d="M10 14 C 28 14, 28 32, 46 32" />
        <path d="M10 32 H 46" />
        <path d="M10 50 C 28 50, 28 32, 46 32" />
        <circle cx="50" cy="32" fill="#fafaf7" r="7" />
        <circle cx="50" cy="32" r="7" />
        <path d="M57 32 H 64" />
      </g>
    </svg>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const card = routeCard(searchParams.get("path"));

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#f4f4f1",
          color: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: "64px",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "18px" }}>
            <div
              style={{
                alignItems: "center",
                background: "#fafaf7",
                border: "1px solid #d2d2cc",
                borderRadius: "18px",
                display: "flex",
                height: "74px",
                justifyContent: "center",
                width: "74px",
              }}
            >
              <ToolRouterMark />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "38px", fontWeight: 700, letterSpacing: "-0.01em" }}>ToolRouter</div>
              <div style={{ color: "#6a6a66", fontSize: "20px" }}>One API for verified tools</div>
            </div>
          </div>
          <div
            style={{
              border: "1px solid #d2d2cc",
              borderRadius: "999px",
              color: "#2a6f4a",
              display: "flex",
              fontSize: "18px",
              fontWeight: 700,
              padding: "12px 18px",
            }}
          >
            AgentKit + x402
          </div>
        </div>

        <div style={{ display: "flex", gap: "44px" }}>
          <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
            <div
              style={{
                color: "#6a6a66",
                fontSize: "22px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                marginBottom: "24px",
                textTransform: "uppercase",
              }}
            >
              {card.eyebrow}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "72px",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 0.96,
                marginBottom: "28px",
                maxWidth: "760px",
              }}
            >
              {card.title}
            </div>
            <div style={{ color: "#555550", display: "flex", fontSize: "28px", lineHeight: 1.35, maxWidth: "790px" }}>
              {card.description}
            </div>
          </div>

          <div
            style={{
              background: "#fafaf7",
              border: "1px solid #d2d2cc",
              borderRadius: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              justifyContent: "center",
              padding: "30px",
              width: "320px",
            }}
          >
            {["Exa Search", "Browserbase Fetch", card.accent].map((label, index) => (
              <div
                key={label}
                style={{
                  alignItems: "center",
                  border: "1px solid #e2e2dd",
                  borderRadius: "14px",
                  display: "flex",
                  gap: "12px",
                  minHeight: "62px",
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    background: index === 2 ? "#dceae0" : "#ecece8",
                    borderRadius: "999px",
                    height: "14px",
                    width: "14px",
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700 }}>{label}</div>
                  <div style={{ color: "#6a6a66", fontSize: "15px" }}>
                    {index === 2 ? "Verified benefit" : "Live checked"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
