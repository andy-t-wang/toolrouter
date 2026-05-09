import "./globals.css";

export const metadata = {
  title: "ToolRouter",
  description: "AgentKit-first x402 tool router dashboard",
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
