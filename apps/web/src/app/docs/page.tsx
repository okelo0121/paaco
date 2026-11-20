import { QuickstartTabs } from "@/components/quickstart-tabs";

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Paaco Developer Docs & MCP Reference
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Integrate non-blocking payment tracing in two lines of TypeScript, stream
          standard OpenTelemetry spans, or query live agent economics right from your IDE
          via MCP.
        </p>
      </div>

      <QuickstartTabs />

      <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#111114] p-5">
        <h2 className="text-base font-semibold text-white">
          Automatic Financial Forensics
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
            <div className="font-mono font-semibold text-rose-300">GHOST_PAYMENT</div>
            <p className="mt-1.5 text-zinc-400">
              Flags any <code>x402</code> call where on-chain settlement succeeded (
              <code>txHash</code> present), yet the merchant returned HTTP <code>5xx</code>,{" "}
              <code>408</code>, or timed out — catching silent double-charges on retry.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
            <div className="font-mono font-semibold text-rose-300">LOOP_BURN</div>
            <p className="mt-1.5 text-zinc-400">
              Flags recursive retry storms hitting the same merchant endpoint 3+ times
              within a single trace or repeating identical transfers after failure.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
            <div className="font-mono font-semibold text-rose-300">GARBAGE_DELIVERY</div>
            <p className="mt-1.5 text-zinc-400">
              Flags settled HTTP <code>200 OK</code> responses containing empty bodies (
              <code>&lt; 16 bytes</code>), HTML 502 error pages, or rate-limit payloads.
            </p>
          </div>
        </div>
      </section>

      <section id="mcp" className="space-y-3 rounded-xl border border-zinc-800 bg-[#111114] p-5">
        <h2 className="text-base font-semibold text-white">
          Hosted Query MCP Server (<code>/api/mcp</code>)
        </h2>
        <p className="text-xs text-zinc-400">
          Built with Vercel Labs <code>mcp-handler</code> v2 on Fluid Compute. Connect
          Cursor, Claude Code, or Antigravity to inspect agent spend directly inside your
          coding session:
        </p>
        <ul className="space-y-2 font-mono text-xs text-zinc-300">
          <li>
            <span className="text-emerald-300">search_payment_traces</span> — Natural-language
            or structured search across traces, chains, merchants, and anomalies.
          </li>
          <li>
            <span className="text-emerald-300">inspect_trace_flamegraph</span> — Returns full
            parent-child span hierarchy, txHash, Explorer URL, and LLM vs tool cost breakdown.
          </li>
          <li>
            <span className="text-emerald-300">list_ghost_payments</span> — Lists settled-but-failed
            or garbage-delivery incidents ready for dispute or triage.
          </li>
          <li>
            <span className="text-emerald-300">get_agent_unit_economics</span> — Summarizes
            token vs payment vs wasted USD per agent and ranks merchant reliability.
          </li>
        </ul>
      </section>
    </div>
  );
}
