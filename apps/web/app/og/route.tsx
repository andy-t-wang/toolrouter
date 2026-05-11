import { ImageResponse } from "next/og.js";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

const routeCards: Record<string, { title: string }> = {
  "/": {
    title: "Tools your agent can trust",
  },
  "/setup": {
    title: "Connect any MCP-capable agent.",
  },
  "/docs": {
    title: "Ship endpoints agents can trust.",
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
          alignItems: "flex-start",
          background: "#f4f4f1",
          color: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, Arial, sans-serif",
          height: "100%",
          justifyContent: "center",
          padding: "64px",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "18px", marginBottom: "72px" }}>
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
          <div style={{ display: "flex", fontSize: "38px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            ToolRouter
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: "98px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 0.92,
            maxWidth: "930px",
          }}
        >
          {card.title}
        </div>
      </div>
    ),
    size,
  );
}
