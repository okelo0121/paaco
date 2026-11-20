import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Paaco — Agent Payment Tracer & Forensic Log Finder",
  description:
    "Datadog + Langfuse for agent money. Correlate LLM tokens, MCP tools, and x402 Solana/Base payments in one Economic Flamegraph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="min-h-screen bg-[#09090b] text-zinc-100 font-sans antialiased">
        <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 border border-emerald-500/40 text-xs font-mono font-bold text-emerald-400">
                  P
                </span>
                <span className="text-sm font-semibold tracking-tight text-white">
                  paaco
                </span>
                <span className="hidden rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 sm:inline-block">
                  x402 + MCP tracer
                </span>
              </Link>

              <nav className="flex items-center gap-1 text-sm">
                <Link
                  href="/"
                  className="rounded-md px-3 py-1.5 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
                >
                  Explorer
                </Link>
                <Link
                  href="/dashboard"
                  className="rounded-md px-3 py-1.5 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
                >
                  FinOps & Alerts
                </Link>
                <Link
                  href="/docs"
                  className="rounded-md px-3 py-1.5 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
                >
                  Docs & MCP
                </Link>
              </nav>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Solana Devnet + Base Sepolia
              </span>
              <Link
                href="/docs#mcp"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-mono text-zinc-300 transition hover:border-zinc-700 hover:text-white"
              >
                MCP: /api/mcp
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
