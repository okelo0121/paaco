# Paaco — Agent Payment Tracer & Forensic Log Finder

**Datadog + Langfuse for Agent Money.**

Paaco correlates your AI agent's prompts, LLM token costs, and MCP tool calls with downstream `HTTP 402` (`x402`) payment challenges, on-chain settlements on **Solana Devnet** & **Base Sepolia**, and post-payment merchant delivery quality — exposing wasted spend in one Economic Flamegraph.

## Architecture

```
@paaco/sdk (2-line wrapFetch / wrapMcpClient) ─┐
OpenTelemetry OTLP/JSON (/api/v1/otlp/v1/traces) ─┼─▶ Paaco Ingest & Forensics Engine
Zero-Signup Live Traced Agent Runner (/) ────────┘          │
                                                           ├─▶ Neon Postgres + Drizzle Ledger
                                                           ├─▶ Vercel Workflow (RPC Reconciliation + Webhook + Triage Hook)
                                                           ├─▶ Web Economic Flamegraph & AI Log Finder (Vercel AI Gateway)
                                                           └─▶ Hosted Query MCP Server (/api/mcp via mcp-handler v2)
```

## 2-Line SDK Quickstart

```ts
import { createPaacoTracer } from "@paaco/sdk";

const paaco = createPaacoTracer({
  apiKey: process.env.PAACO_API_KEY!,
  endpoint: "https://your-paaco-deployment.vercel.app",
  agentId: "research-agent",
});

const tracedFetch = paaco.wrapFetch(fetch);

await paaco.runTrace({ userPrompt: "Fetch live SOL/USDC spread", userId: "usr_42" }, async () => {
  await tracedFetch("https://paid-merchant.example/quote");
});
```

## OpenTelemetry OTLP Ingest

Point Vercel AI SDK / OpenTelemetry exporters directly at:
`POST /api/v1/otlp/v1/traces` with header `x-paaco-key: <your_api_key>`.

## Connect Paaco MCP to Cursor / Claude Code / Antigravity

```json
{
  "mcpServers": {
    "paaco": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer paaco_demo_readonly_key"
      }
    }
  }
}
```

Available MCP tools:
- `search_payment_traces` — Natural-language or structured search across traces, chains, and anomalies
- `inspect_trace_flamegraph` — Hierarchical span tree + LLM vs. tool payment vs. wasted USD breakdown
- `list_ghost_payments` — Settled-but-failed, double-paid, and empty-delivery incidents with Explorer URLs
- `get_agent_unit_economics` — True unit economics and merchant reliability leaderboard

## Local Development

```bash
pnpm install
pnpm dev
```

No database or API keys are needed to explore locally: when `DATABASE_URL` is unset, Paaco boots in a pre-seeded in-memory mode with realistic Solana Devnet and Base Sepolia forensic traces, live `@paaco/sdk` agent runner, AI Log Finder fallback, CSV export, and `/api/mcp`.
