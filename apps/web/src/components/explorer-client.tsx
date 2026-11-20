"use client";

import { formatMicroUsd } from "@paaco/shared";
import { Activity, AlertTriangle, Coins, Flame, Layers } from "lucide-react";
import { useState } from "react";
import type {
  StoredTrace,
  TraceDetail,
  UnitEconomicsReport,
} from "@/db/repository";
import { EconomicFlamegraph } from "./flamegraph";
import { LiveAgentRunner } from "./live-agent-runner";
import { LogFinder, type LogSearchApiResponse } from "./log-finder";
import { QuickstartTabs } from "./quickstart-tabs";

interface ExplorerClientProps {
  initialTraces: StoredTrace[];
  initialDetail: TraceDetail | null;
  initialEconomics: UnitEconomicsReport;
}

export function ExplorerClient({
  initialTraces,
  initialDetail,
  initialEconomics,
}: ExplorerClientProps) {
  const [traces, setTraces] = useState<StoredTrace[]>(initialTraces);
  const [selectedDetail, setSelectedDetail] = useState<TraceDetail | null>(
    initialDetail,
  );
  const [economics, setEconomics] = useState<UnitEconomicsReport>(initialEconomics);
  const [loadingTraceId, setLoadingTraceId] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<LogSearchApiResponse | null>(null);

  async function selectTrace(traceId: string) {
    setLoadingTraceId(traceId);
    try {
      const res = await fetch(`/api/v1/traces/${encodeURIComponent(traceId)}`);
      if (res.ok) {
        const detail = (await res.json()) as TraceDetail;
        setSelectedDetail(detail);
      }
    } finally {
      setLoadingTraceId(null);
    }
  }

  async function refreshAll(selectId?: string) {
    const [tracesRes, econRes] = await Promise.all([
      fetch("/api/v1/traces?limit=25"),
      fetch("/api/v1/economics"),
    ]);
    if (tracesRes.ok) {
      const data = (await tracesRes.json()) as { traces: StoredTrace[] };
      setTraces(data.traces);
      const targetId = selectId ?? selectedDetail?.trace.id ?? data.traces[0]?.id;
      if (targetId) {
        await selectTrace(targetId);
      }
    }
    if (econRes.ok) {
      const econ = (await econRes.json()) as UnitEconomicsReport;
      setEconomics(econ);
    }
  }

  function handleLiveTraceCreated(detail: TraceDetail) {
    setActiveSearch(null);
    setTraces((prev) => [
      detail.trace,
      ...prev.filter((t) => t.id !== detail.trace.id),
    ]);
    setSelectedDetail(detail);
    void fetch("/api/v1/economics")
      .then((r) => (r.ok ? (r.json() as Promise<UnitEconomicsReport>) : null))
      .then((econ) => {
        if (econ) setEconomics(econ);
      });
  }

  function handleSearchResults(matched: StoredTrace[], meta: LogSearchApiResponse | null) {
    setActiveSearch(meta);
    setTraces(matched);
    if (matched[0]) {
      void selectTrace(matched[0].id);
    } else {
      setSelectedDetail(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Every token, MCP call, and x402 payment — traced.
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            Zero-custody observability for agent money. Catch Ghost Payments (settled
            on-chain, merchant 5xx), Retry Loop Burns, and Garbage 200 Deliveries across
            Solana Devnet and Base Sepolia.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
          <span className="rounded-md border border-zinc-800 bg-[#111114] px-2.5 py-1.5">
            Open Alerts:{" "}
            <strong className="text-rose-400 tabular-nums">
              {economics.totals.openAlertCount}
            </strong>
          </span>
          <a
            href="/api/v1/export.csv"
            className="rounded-md border border-zinc-800 bg-[#111114] px-3 py-1.5 text-zinc-200 transition hover:border-zinc-600 hover:text-white"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Total Traced Spend</span>
            <Activity className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
            {formatMicroUsd(economics.totals.totalMicroUsd)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-500 tabular-nums">
            across {economics.totals.traceCount} traced runs
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>LLM Token Spend</span>
            <Layers className="h-4 w-4 text-violet-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-violet-300 tabular-nums">
            {formatMicroUsd(economics.totals.llmTokenMicroUsd)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-500">
            AI SDK / OTel GenAI spans
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>x402 Tool Payments</span>
            <Coins className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-emerald-300 tabular-nums">
            {formatMicroUsd(economics.totals.toolPaymentMicroUsd)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-500">
            Solana Devnet + Base Sepolia
          </div>
        </div>

        <div className="rounded-xl border border-rose-500/30 bg-[#111114] p-4">
          <div className="flex items-center justify-between text-xs text-rose-300">
            <span>Wasted Spend Caught</span>
            <Flame className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-rose-400 tabular-nums">
            {formatMicroUsd(economics.totals.wastedMicroUsd)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-400">
            Ghost, Loop & Garbage incidents
          </div>
        </div>
      </div>

      {/* AI Log Finder + Live SDK Agent Runner */}
      <div className="space-y-3">
        <LogFinder
          onResults={handleSearchResults}
          onReset={() => {
            setActiveSearch(null);
            void refreshAll();
          }}
        />
        <LiveAgentRunner onTraceCreated={handleLiveTraceCreated} />
      </div>

      {/* Split-Screen Trace Stream + Economic Flamegraph */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-4 space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {activeSearch
                ? `Matched Traces (${traces.length})`
                : `Recent Agent Traces (${traces.length})`}
            </h2>
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="font-mono text-[11px] text-zinc-400 hover:text-white"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-2 max-h-[760px] overflow-y-auto pr-1">
            {traces.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-[#111114] p-6 text-center text-xs text-zinc-500">
                No traces matched this filter.
              </div>
            ) : (
              traces.map((trace) => {
                const isSelected = selectedDetail?.trace.id === trace.id;
                return (
                  <button
                    key={trace.id}
                    type="button"
                    onClick={() => void selectTrace(trace.id)}
                    className={`w-full rounded-xl border p-3.5 text-left transition ${
                      isSelected
                        ? "border-emerald-500/60 bg-zinc-900"
                        : "border-zinc-800 bg-[#111114] hover:border-zinc-700 hover:bg-zinc-900/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs font-semibold text-zinc-200">
                        {trace.agentId}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {trace.hasAnomalies && (
                          <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                            <AlertTriangle className="h-3 w-3" />
                            {trace.anomalyCount}
                          </span>
                        )}
                        <span className="font-mono text-xs font-semibold text-white tabular-nums">
                          {formatMicroUsd(trace.totalMicroUsd)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">
                      {trace.userPrompt}
                    </p>

                    <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-zinc-500 tabular-nums">
                      <span>
                        {loadingTraceId === trace.id ? "Loading..." : `${trace.durationMs}ms`}
                      </span>
                      {trace.wastedMicroUsd > 0 ? (
                        <span className="text-rose-400">
                          wasted {formatMicroUsd(trace.wastedMicroUsd)}
                        </span>
                      ) : (
                        <span className="text-emerald-400/90">clean</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-8">
          <EconomicFlamegraph
            detail={selectedDetail}
            onAlertTriaged={() => void refreshAll(selectedDetail?.trace.id)}
          />
        </div>
      </div>

      {/* 2-Line SDK, OTLP & Cursor MCP Quickstart */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Connect Your Agent or IDE in 60 Seconds
        </h2>
        <QuickstartTabs />
      </div>
    </div>
  );
}
