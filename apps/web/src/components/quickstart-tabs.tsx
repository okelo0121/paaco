"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

const TABS = [
  {
    id: "sdk",
    label: "2-Line @paaco/sdk",
    code: `import { createPaacoTracer } from "@paaco/sdk";

const paaco = createPaacoTracer({
  apiKey: process.env.PAACO_API_KEY!,
  endpoint: "https://your-paaco-app.vercel.app",
  agentId: "arb-liquidity-agent",
});

const tracedFetch = paaco.wrapFetch(fetch); // or wrapFetchWithPayment(...)

await paaco.runTrace({ userPrompt: "Fetch SOL/USDC quote", userId: "usr_42" }, async () => {
  await tracedFetch("https://oracle.example/v2/pools");
});`,
  },
  {
    id: "otlp",
    label: "OpenTelemetry OTLP",
    code: `// Point Vercel AI SDK experimental_telemetry / OTel exporter directly at Paaco:
POST https://your-paaco-app.vercel.app/api/v1/otlp/v1/traces
Headers:
  Content-Type: application/json
  x-paaco-key: paaco_demo_readonly_key

// Span attributes automatically extracted:
// - gen_ai.request.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
// - mcp.server.name, mcp.tool.name
// - x402.network, x402.amount_micro_usd, x402.pay_to, x402.tx_hash`,
  },
  {
    id: "mcp",
    label: "Cursor / Claude Code MCP",
    code: `{
  "mcpServers": {
    "paaco": {
      "url": "https://your-paaco-app.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer paaco_demo_readonly_key"
      }
    }
  }
}

// Ask your IDE agent:
// "Paaco, find all Ghost Payments on Solana Devnet and inspect the trace flamegraph."`,
  },
] as const;

export function QuickstartTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("sdk");
  const [copied, setCopied] = useState(false);

  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  async function copyCode() {
    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                active === t.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void copyCode()}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:border-zinc-500"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
