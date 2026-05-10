import "./globals.css";

import type { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_TOOLROUTER_APP_URL || "https://toolrouter.world";
const defaultDescription =
  "ToolRouter is an MCP server your agent connects to once. Every endpoint behind it is verified, paid through AgentKit, and traced end-to-end.";
const defaultOgImage = {
  url: "/og?path=/",
  width: 1200,
  height: 630,
  alt: "ToolRouter",
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "ToolRouter",
  description: defaultDescription,
  openGraph: {
    title: "ToolRouter",
    description: defaultDescription,
    url: "/",
    siteName: "ToolRouter",
    type: "website",
    images: [defaultOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "ToolRouter",
    description: defaultDescription,
    images: [defaultOgImage],
  },
  icons: {
    icon: [
      { url: "/toolrouter-mark.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/toolrouter-mark.svg",
    apple: "/toolrouter-mark.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/toolrouter-mark.svg" type="image/svg+xml" />
        <link rel="shortcut icon" href="/toolrouter-mark.svg" />
        <link rel="apple-touch-icon" href="/toolrouter-mark.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
