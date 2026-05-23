import { ImageResponse } from "next/og.js";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

const palette = {
  bone: "#f4f4f1",
  ink: "#0a0a0a",
  ink2: "#1a1a1a",
  mute: "#5c5c58",
  line: "#d8d8d2",
  line2: "#c8c8c2",
  card: "#ffffff",
  green: "#1f7a3f",
  greenSoft: "#e0eedf",
  blue: "#1f4fd9",
  blueSoft: "#dfe6fb",
};

const routeCards: Record<string, { title: string }> = {
  "/": {
    title: "Tools your agent can actually trust.",
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

// Glyph subset covering every label rendered below, in both cases (textTransform
// uppercases the mono labels at render time, so the uppercase forms must exist).
const FONT_SUBSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?&%()/'\"-";

type LoadedFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600;
  style: "normal";
};

async function loadGoogleFont(
  family: string,
  name: string,
  weight: 400 | 500 | 600,
): Promise<LoadedFont | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(
      FONT_SUBSET,
    )}`;
    const cssRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const match = css.match(
      /src:\s*url\((.+?)\)\s*format\('(?:opentype|truetype)'\)/,
    );
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return null;
    return { name, data: await fontRes.arrayBuffer(), weight, style: "normal" };
  } catch {
    return null;
  }
}

function ToolRouterMark() {
  return (
    <svg width="48" height="38" viewBox="0 0 80 64" fill="none">
      <g
        fill="none"
        stroke={palette.ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
        transform="translate(8 7)"
      >
        <circle cx="6" cy="14" fill={palette.ink} r="5" />
        <circle cx="6" cy="32" fill={palette.ink} r="5" />
        <circle cx="6" cy="50" fill={palette.ink} r="5" />
        <path d="M10 14 C 28 14, 28 32, 46 32" />
        <path d="M10 32 H 46" />
        <path d="M10 50 C 28 50, 28 32, 46 32" />
        <circle cx="50" cy="32" fill={palette.bone} r="7" />
        <circle cx="50" cy="32" r="7" />
        <path d="M57 32 H 64" />
      </g>
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path
        d="M5 19 L11 13 L15 17 L23 9"
        stroke={palette.green}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 9 H 23 V 14"
        stroke={palette.green}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path
        d="M14 3 L23 6 V14 C23 19 19 23 14 25 C9 23 5 19 5 14 V6 Z"
        fill={palette.blue}
        stroke={palette.blue}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 14 L13 17.5 L19 11"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect
        x="3.5"
        y="7"
        width="21"
        height="14"
        rx="2.5"
        stroke={palette.green}
        strokeWidth="1.8"
        fill="none"
      />
      <path d="M3.5 11 H 24.5" stroke={palette.green} strokeWidth="1.8" />
      <circle cx="20" cy="18" r="4.5" fill={palette.green} />
      <path
        d="M18 18 L19.5 19.5 L22 17"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

type Accent = "green" | "blue";

function Feature({
  accent,
  icon,
  title,
  body,
}: {
  accent: Accent;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const iconBg = accent === "green" ? palette.greenSoft : palette.blueSoft;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 16,
        minHeight: 96,
        padding: "18px 20px",
        background: palette.card,
        border: `1px solid ${palette.line}`,
        borderRadius: 14,
        boxShadow: "0 1px 0 rgba(11,11,12,0.03)",
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          background: iconBg,
          border: `1px solid ${iconBg}`,
        }}
      >
        {icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "Inter Tight",
            fontWeight: 600,
            fontSize: 18,
            lineHeight: 1.1,
            letterSpacing: -0.3,
            color: palette.ink,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "Inter",
            fontSize: 13.5,
            lineHeight: 1.35,
            color: palette.mute,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const card = routeCard(searchParams.get("path"));

  const fonts = (
    await Promise.all([
      loadGoogleFont("Inter+Tight", "Inter Tight", 400),
      loadGoogleFont("Inter+Tight", "Inter Tight", 600),
      loadGoogleFont("Inter", "Inter", 400),
      loadGoogleFont("JetBrains+Mono", "JetBrains Mono", 500),
    ])
  ).filter((font): font is LoadedFont => font !== null);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          background: palette.bone,
          color: palette.ink,
          fontFamily: "Inter",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `linear-gradient(${palette.line} 1px, transparent 1px), linear-gradient(90deg, ${palette.line} 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
            opacity: 0.35,
          }}
        />

        {/* Top brand */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 60,
            right: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ToolRouterMark />
            <div
              style={{
                fontFamily: "Inter Tight",
                fontWeight: 600,
                fontSize: 28,
                letterSpacing: -0.7,
                color: palette.ink,
              }}
            >
              ToolRouter
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 30,
              padding: "0 12px",
              border: `1px solid ${palette.line2}`,
              borderRadius: 999,
              background: palette.card,
              fontFamily: "JetBrains Mono",
              fontWeight: 500,
              fontSize: 11,
              letterSpacing: 1.54,
              textTransform: "uppercase",
              color: palette.ink2,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: palette.green,
              }}
            />
            One MCP endpoint
          </div>
        </div>

        {/* Headline + lede */}
        <div
          style={{
            position: "absolute",
            top: 118,
            left: 60,
            right: 60,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontFamily: "Inter Tight",
              fontWeight: 600,
              fontSize: 86,
              lineHeight: 0.96,
              letterSpacing: -3.9,
              marginBottom: 22,
              maxWidth: 640,
              color: palette.ink,
            }}
          >
            {card.title}
          </div>
          {/* Satori lays each span out as a flex item, so non-breaking spaces
              keep the gaps around the colored words from collapsing at item edges. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              maxWidth: 560,
              fontFamily: "Inter Tight",
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.4,
              letterSpacing: -0.1,
              color: palette.ink2,
            }}
          >
            <span>{"One MCP endpoint for "}</span>
            <span style={{ color: palette.green, fontWeight: 600 }}>AgentKit</span>
            <span>{" boosts, verified "}</span>
            <span style={{ color: palette.blue, fontWeight: 600 }}>x402</span>
            <span>{", and "}</span>
            <span>{"simple API billing."}</span>
          </div>
        </div>

        {/* Feature cards */}
        <div
          style={{
            position: "absolute",
            left: 60,
            right: 60,
            bottom: 60,
            display: "flex",
            gap: 14,
          }}
        >
          <Feature
            accent="green"
            icon={<TrendIcon />}
            title="AgentKit boosts"
            body="Free trials, access, discounts"
          />
          <Feature
            accent="blue"
            icon={<ShieldIcon />}
            title="Verified x402"
            body="Checked before agents spend"
          />
          <Feature
            accent="green"
            icon={<CardIcon />}
            title="Simple billing"
            body="API keys, no wallet management"
          />
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 18,
            left: 60,
            right: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "JetBrains Mono",
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: 1.54,
            textTransform: "uppercase",
            color: palette.mute,
          }}
        >
          <div style={{ display: "flex", color: palette.ink }}>toolrouter.world</div>
          <div style={{ display: "flex" }}>The agent commerce layer</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    },
  );
}
