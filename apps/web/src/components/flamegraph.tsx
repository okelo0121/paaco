"use client";

import { formatMicroUsd, getNetworkInfo, type TriageStatus } from "@paaco/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileJson,
  ShieldAlert,
  Terminal,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StoredAlert, StoredSpan, TraceDetail } from "@/db/repository";

interface FlamegraphProps {
  detail: TraceDetail | null;
  onAlertTriaged?: () => void;
}

interface SpanNode {
  span: StoredSpan;
  depth: number;
}

function buildOrderedNodes(spans: StoredSpan[]): SpanNode[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const children = new Map<string, StoredSpan[]>();
  const roots: StoredSpan[] = [];

  for (const s of spans) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      const list = children.get(s.parentSpanId) ?? [];
      list.push(s);
      children.set(s.parentSpanId, list);
    } else {
      roots.push(s);
    }
  }

  const out: SpanNode[] = [];
  const visit = (node: StoredSpan, depth: number) => {
    out.push({ span: node, depth });
    const kids = (children.get(node.id) ?? []).sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    for (const k of kids) visit(k, depth + 1);
  };

  roots.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const r of roots) visit(r, 0);
  return out;
}

function kindBadge(kind: string, wasted: number, settlementStatus?: string) {
  if (wasted > 0 || settlementStatus === "ghost_payment") {
    return {
      bar: "bg-rose-500/80 border-rose-400",
      pill: "bg-rose-500/15 text-rose-300 border-rose-500/40",
      label: "ANOMALY",
    };
  }
  if (kind === "llm") {
    return {
      bar: "bg-violet-500/75 border-violet-400",
      pill: "bg-violet-500/15 text-violet-300 border-violet-500/40",
      label: "LLM",
    };
  }
  if (kind === "mcp_tool") {
    return {
      bar: "bg-sky-500/75 border-sky-400",
      pill: "bg-sky-500/15 text-sky-300 border-sky-500/40",
      label: "MCP",
    };
  }
  if (settlementStatus === "quoted") {
    return {
      bar: "bg-amber-500/75 border-amber-400",
      pill: "bg-amber-500/15 text-amber-300 border-amber-500/40",
      label: "402 QUOTE",
    };
  }
  return {
    bar: "bg-emerald-500/75 border-emerald-400",
    pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    label: "x402 PAY",
  };
}

function alertBadgeLabel(alertType: StoredAlert["alertType"]): string {
  switch (alertType) {
    case "GHOST_PAYMENT":
      return "GHOST PAYMENT";
    case "LOOP_BURN":
      return "LOOP BURN";
    case "GARBAGE_DELIVERY":
      return "GARBAGE DELIVERY";
    case "RECON_MISMATCH":
      return "RECON MISMATCH";
  }
}

export function EconomicFlamegraph({ detail, onAlertTriaged }: FlamegraphProps) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [triagingId, setTriagingId] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      setSelectedSpanId(null);
      return;
    }
    const anomalySpan = detail.spans.find((s) => s.wastedMicroUsd > 0);
    const paySpan = detail.spans.find((s) => s.kind === "http_payment");
    setSelectedSpanId((anomalySpan ?? paySpan ?? detail.spans[0])?.id ?? null);
  }, [detail]);

  const ordered = useMemo(
    () => (detail ? buildOrderedNodes(detail.spans) : []),
    [detail],
  );

  if (!detail) {
    return (
      <div className="flex h-[540px] items-center justify-center rounded-xl border border-zinc-800 bg-[#111114] text-sm text-zinc-400">
        Select a trace on the left or run a live traced agent to inspect its Economic Flamegraph.
      </div>
    );
  }

  const { trace, spans, alerts } = detail;
  const traceStartMs = new Date(trace.startedAt).getTime();
  const traceEndMs = Math.max(traceStartMs + 1, new Date(trace.endedAt).getTime());
  const totalWindowMs = Math.max(1, traceEndMs - traceStartMs);

  const selectedSpan = spans.find((s) => s.id === selectedSpanId) ?? spans[0] ?? null;
  const alertsBySpan = new Map<string, StoredAlert[]>();
  for (const a of alerts) {
    const arr = alertsBySpan.get(a.spanId) ?? [];
    arr.push(a);
    alertsBySpan.set(a.spanId, arr);
  }

  async function handleTriage(alertId: string, status: TriageStatus) {
    setTriagingId(alertId);
    try {
      await fetch(`/api/v1/alerts/${encodeURIComponent(alertId)}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          note: `Triaged directly from Explorer (${status})`,
        }),
      });
      onAlertTriaged?.();
    } finally {
      setTriagingId(null);
    }
  }

  function downloadDisputeBundle() {
    const payload = {
      exportedAt: new Date().toISOString(),
      trace,
      alerts,
      paymentSpans: spans.filter((s) => s.kind === "http_payment"),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${trace.id}-forensic-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Trace Summary Card */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-zinc-400">{trace.id}</span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-200">
                {trace.agentId}
              </span>
              {trace.userId && (
                <span className="rounded border border-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                  user:{trace.userId}
                </span>
              )}
              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                {trace.durationMs}ms
              </span>
            </div>
            <p className="text-sm font-medium text-zinc-100">{trace.userPrompt}</p>
          </div>

          <button
            type="button"
            onClick={downloadDisputeBundle}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
          >
            <FileJson className="h-3.5 w-3.5" />
            Export Dispute JSON
          </button>
        </div>

        {/* Unit Economics Mini Strip */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
            <div className="text-[11px] text-zinc-400">Total Run Cost</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
              {formatMicroUsd(trace.totalMicroUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
            <div className="text-[11px] text-zinc-400">LLM Tokens</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-violet-300 tabular-nums">
              {formatMicroUsd(trace.llmTokenMicroUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
            <div className="text-[11px] text-zinc-400">x402 Tool Payments</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-300 tabular-nums">
              {formatMicroUsd(trace.toolPaymentMicroUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
            <div className="text-[11px] text-zinc-400">Wasted Spend</div>
            <div
              className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                trace.wastedMicroUsd > 0 ? "text-rose-400" : "text-zinc-400"
              }`}
            >
              {formatMicroUsd(trace.wastedMicroUsd)}
            </div>
          </div>
        </div>
      </div>

      {/* Forensic Alerts Strip */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-950/20 px-4 py-3"
            >
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                      {alertBadgeLabel(alert.alertType)}
                    </span>
                    <span className="font-mono text-xs font-semibold text-rose-300 tabular-nums">
                      -{formatMicroUsd(alert.wastedMicroUsd)} wasted
                    </span>
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                      {alert.triageStatus}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-200">{alert.summary}</p>
                </div>
              </div>

              {alert.triageStatus === "OPEN" && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={triagingId === alert.id}
                    onClick={() => handleTriage(alert.id, "ACKNOWLEDGED")}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    disabled={triagingId === alert.id}
                    onClick={() => handleTriage(alert.id, "MERCHANT_FLAGGED")}
                    className="rounded-md border border-rose-500/50 bg-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    Flag Merchant
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Interactive Economic Flamegraph */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Economic Flamegraph ({ordered.length} spans)
          </h3>
          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-violet-500" /> LLM
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-sky-500" /> MCP
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" /> x402 Settled
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-rose-500" /> Anomaly
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          {ordered.map(({ span, depth }) => {
            const spStart = new Date(span.startedAt).getTime();
            const spEnd = Math.max(spStart + 1, new Date(span.endedAt).getTime());
            const leftPct = Math.max(0, Math.min(96, ((spStart - traceStartMs) / totalWindowMs) * 100));
            const widthPct = Math.max(3, Math.min(100 - leftPct, ((spEnd - spStart) / totalWindowMs) * 100));
            const style = kindBadge(span.kind, span.wastedMicroUsd, span.settlementStatus);
            const isSelected = selectedSpan?.id === span.id;
            const spanAlerts = alertsBySpan.get(span.id) ?? [];

            return (
              <button
                key={span.id}
                type="button"
                onClick={() => setSelectedSpanId(span.id)}
                className={`grid w-full grid-cols-12 items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition ${
                  isSelected
                    ? "border-zinc-500 bg-zinc-900"
                    : "border-transparent bg-zinc-950/50 hover:border-zinc-800 hover:bg-zinc-900/60"
                }`}
              >
                <div
                  className="col-span-6 flex items-center gap-2 overflow-hidden sm:col-span-5"
                  style={{ paddingLeft: `${depth * 14}px` }}
                >
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${style.pill}`}
                  >
                    {style.label}
                  </span>
                  <span className="truncate font-mono text-xs text-zinc-200">
                    {span.name}
                  </span>
                </div>

                <div className="col-span-4 hidden sm:block">
                  <div className="relative h-3 w-full rounded bg-zinc-900">
                    <div
                      className={`absolute top-0 h-3 rounded border ${style.bar}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  </div>
                </div>

                <div className="col-span-6 flex items-center justify-end gap-2 font-mono text-xs tabular-nums sm:col-span-3">
                  {spanAlerts.length > 0 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span className={span.wastedMicroUsd > 0 ? "text-rose-400 font-semibold" : "text-zinc-300"}>
                    {span.costMicroUsd > 0 ? formatMicroUsd(span.costMicroUsd) : "—"}
                  </span>
                  <span className="text-[11px] text-zinc-500">{span.durationMs}ms</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Span & x402 Payload Inspector */}
      {selectedSpan && (
        <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              {selectedSpan.kind === "llm" ? (
                <Cpu className="h-4 w-4 text-violet-400" />
              ) : selectedSpan.kind === "mcp_tool" ? (
                <Terminal className="h-4 w-4 text-sky-400" />
              ) : (
                <Wallet className="h-4 w-4 text-emerald-400" />
              )}
              <span className="font-mono text-xs font-semibold text-white">
                {selectedSpan.name}
              </span>
              <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                status: {selectedSpan.status}
              </span>
            </div>

            {selectedSpan.explorerUrl && (
              <a
                href={selectedSpan.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/20"
              >
                View On-Chain Explorer
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {selectedSpan.kind === "llm" && (
              <>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1">
                  <div className="text-zinc-500">MODEL & TOKENS</div>
                  <div className="text-zinc-200">model: {selectedSpan.model}</div>
                  <div className="text-zinc-300">
                    in: {selectedSpan.inputTokens ?? 0} | out: {selectedSpan.outputTokens ?? 0}
                    {selectedSpan.reasoningTokens ? ` | reason: ${selectedSpan.reasoningTokens}` : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1">
                  <div className="text-zinc-500">COST & TIMING</div>
                  <div className="text-violet-300">
                    tokenCost: {formatMicroUsd(selectedSpan.costMicroUsd)}
                  </div>
                  <div className="text-zinc-400">duration: {selectedSpan.durationMs}ms</div>
                </div>
              </>
            )}

            {selectedSpan.kind === "mcp_tool" && (
              <>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1">
                  <div className="text-zinc-500">MCP SERVER / TOOL</div>
                  <div className="text-sky-300">
                    {selectedSpan.mcpServer} / {selectedSpan.mcpTool}
                  </div>
                  <div className="text-zinc-400">
                    responseBytes: {selectedSpan.responseBytes ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1">
                  <div className="text-zinc-500">ARGUMENTS PREVIEW</div>
                  <div className="break-all text-zinc-300">
                    {selectedSpan.argsPreview ?? "{}"}
                  </div>
                </div>
              </>
            )}

            {selectedSpan.kind === "http_payment" && (
              <>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1.5">
                  <div className="text-zinc-500">x402 PAYMENT & ON-CHAIN SETTLEMENT</div>
                  <div className="text-zinc-200">
                    network:{" "}
                    <span className="text-emerald-300">
                      {getNetworkInfo(selectedSpan.network)?.label ?? selectedSpan.network}
                    </span>
                  </div>
                  <div className="text-zinc-300">
                    amount: {formatMicroUsd(selectedSpan.costMicroUsd)} | http:{" "}
                    <span
                      className={
                        (selectedSpan.httpStatus ?? 200) >= 500
                          ? "text-rose-400 font-semibold"
                          : "text-zinc-200"
                      }
                    >
                      {selectedSpan.httpStatus ?? "—"}
                    </span>
                  </div>
                  <div className="break-all text-zinc-400">payTo: {selectedSpan.payTo}</div>
                  <div className="break-all text-zinc-300">
                    txHash: {selectedSpan.txHash ?? "quote-only (no tx signed)"}
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>RECONCILIATION & RESPONSE</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {selectedSpan.reconciliationStatus ?? "n/a"}
                    </span>
                  </div>
                  <div className="text-zinc-300">
                    settlement: {selectedSpan.settlementStatus ?? "—"}
                  </div>
                  {selectedSpan.reconciliationDetail && (
                    <div className="text-zinc-400">{selectedSpan.reconciliationDetail}</div>
                  )}
                  {selectedSpan.responsePreview && (
                    <div className="mt-1 rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] break-all text-zinc-300">
                      {selectedSpan.responsePreview}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
