"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import type { TraceDetail } from "@/db/repository";

interface LiveAgentRunnerProps {
  onTraceCreated: (detail: TraceDetail) => void;
}

const SCENARIOS = [
  { id: "ghost-timeout", label: "Ghost Payment (504 + Double-Pay)" },
  { id: "flaky-loop", label: "Runaway Retry Loop (4x Burn)" },
  { id: "empty-payload", label: "Garbage Delivery (HTML in 200 OK)" },
  { id: "clean-quote", label: "Clean Paid Call ($0.05)" },
] as const;

export function LiveAgentRunner({ onTraceCreated }: LiveAgentRunnerProps) {
  const [chain, setChain] = useState<"solana" | "base">("solana");
  const [scenario, setScenario] =
    useState<(typeof SCENARIOS)[number]["id"]>("ghost-timeout");
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/playground/run-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario, chain }),
      });
      if (!res.ok) {
        setStatusMsg("Failed to run traced agent.");
        return;
      }
      const json = (await res.json()) as {
        traceId?: string;
        alertsCreated?: number;
        detail?: TraceDetail | null;
      };
      if (json.detail) {
        onTraceCreated(json.detail);
        setStatusMsg(
          `Ingested ${json.traceId} (${json.alertsCreated ?? 0} forensic alert${
            json.alertsCreated === 1 ? "" : "s"
          })`,
        );
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-[#111114] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-200">
          Live @paaco/sdk Agent Runner:
        </span>

        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setChain("solana")}
            className={`rounded-md px-2.5 py-1 font-mono transition ${
              chain === "solana"
                ? "bg-zinc-800 text-emerald-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Solana Devnet
          </button>
          <button
            type="button"
            onClick={() => setChain("base")}
            className={`rounded-md px-2.5 py-1 font-mono transition ${
              chain === "base"
                ? "bg-zinc-800 text-sky-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Base Sepolia
          </button>
        </div>

        <select
          value={scenario}
          onChange={(e) => setScenario(e.target.value as (typeof SCENARIOS)[number]["id"])}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        {statusMsg && (
          <span className="font-mono text-[11px] text-emerald-300">{statusMsg}</span>
        )}
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-60"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? "Executing Agent..." : "Run Traced Agent"}
        </button>
      </div>
    </div>
  );
}
