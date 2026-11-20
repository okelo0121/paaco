"use client";

import { formatMicroUsd, getNetworkInfo, type TriageStatus } from "@paaco/shared";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  StoredAlert,
  StoredApiKey,
  UnitEconomicsReport,
} from "@/db/repository";

interface DashboardClientProps {
  initialEconomics: UnitEconomicsReport;
  initialAlerts: StoredAlert[];
  initialKeys: StoredApiKey[];
  databaseConfigured: boolean;
}

export function DashboardClient({
  initialEconomics,
  initialAlerts,
  initialKeys,
  databaseConfigured,
}: DashboardClientProps) {
  const [economics, setEconomics] = useState(initialEconomics);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [keys, setKeys] = useState(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refreshDashboard() {
    const [econRes, alertRes, keyRes] = await Promise.all([
      fetch("/api/v1/economics"),
      fetch("/api/v1/alerts"),
      fetch("/api/v1/keys"),
    ]);
    if (econRes.ok) setEconomics((await econRes.json()) as UnitEconomicsReport);
    if (alertRes.ok) {
      const d = (await alertRes.json()) as { alerts: StoredAlert[] };
      setAlerts(d.alerts);
    }
    if (keyRes.ok) {
      const k = (await keyRes.json()) as { keys: StoredApiKey[] };
      setKeys(k.keys);
    }
  }

  async function triage(alertId: string, status: TriageStatus) {
    setBusyId(alertId);
    try {
      await fetch(`/api/v1/alerts/${encodeURIComponent(alertId)}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await refreshDashboard();
    } finally {
      setBusyId(null);
    }
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (res.ok) {
      const created = (await res.json()) as {
        apiKey: StoredApiKey;
        plaintextKey: string;
      };
      setCreatedPlaintext(created.plaintextKey);
      setNewKeyName("");
      await refreshDashboard();
    }
  }

  async function revokeKey(id: string) {
    await fetch(`/api/v1/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshDashboard();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            FinOps Control Plane & Forensic Alerts
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Unit economics across LLM tokens & x402 tools, merchant reliability scoring,
            and workflow-backed incident triage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-md border border-zinc-800 bg-[#111114] px-2.5 py-1.5 font-mono text-[11px] text-zinc-400">
            Storage: {databaseConfigured ? "Neon Postgres" : "Zero-Signup Demo Memory"}
          </span>
          <a
            href="/api/v1/export.csv"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            <Download className="h-3.5 w-3.5" />
            Export FinOps CSV
          </a>
        </div>
      </div>

      {/* Agent Unit Economics */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Agent Unit Economics
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 font-mono text-[11px] text-zinc-500">
                <th className="pb-2 pr-4">Agent ID</th>
                <th className="pb-2 pr-4">Traces</th>
                <th className="pb-2 pr-4">LLM Tokens</th>
                <th className="pb-2 pr-4">x402 Tools</th>
                <th className="pb-2 pr-4">Total Spend</th>
                <th className="pb-2 pr-4">Wasted Spend</th>
                <th className="pb-2">Waste %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 font-mono tabular-nums">
              {economics.byAgent.map((row) => (
                <tr key={row.agentId} className="text-zinc-200">
                  <td className="py-2.5 pr-4 font-semibold text-white">{row.agentId}</td>
                  <td className="py-2.5 pr-4">{row.traceCount}</td>
                  <td className="py-2.5 pr-4 text-violet-300">
                    {formatMicroUsd(row.llmTokenMicroUsd)}
                  </td>
                  <td className="py-2.5 pr-4 text-emerald-300">
                    {formatMicroUsd(row.toolPaymentMicroUsd)}
                  </td>
                  <td className="py-2.5 pr-4 text-white">
                    {formatMicroUsd(row.totalMicroUsd)}
                  </td>
                  <td className="py-2.5 pr-4 text-rose-400">
                    {formatMicroUsd(row.wastedMicroUsd)}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        row.wasteRatePct > 10
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {row.wasteRatePct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Merchant Reliability Leaderboard */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          x402 Merchant Reliability Leaderboard
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 font-mono text-[11px] text-zinc-500">
                <th className="pb-2 pr-4">Merchant Domain</th>
                <th className="pb-2 pr-4">Network</th>
                <th className="pb-2 pr-4">Paid Calls</th>
                <th className="pb-2 pr-4">Volume</th>
                <th className="pb-2 pr-4">Bad Deliveries</th>
                <th className="pb-2">Reliability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 font-mono tabular-nums">
              {economics.byMerchant.map((m) => (
                <tr key={`${m.merchantDomain}-${m.network}`} className="text-zinc-200">
                  <td className="py-2.5 pr-4 text-white">{m.merchantDomain}</td>
                  <td className="py-2.5 pr-4 text-zinc-400">
                    {getNetworkInfo(m.network)?.shortLabel ?? m.network}
                  </td>
                  <td className="py-2.5 pr-4">{m.paidCallCount}</td>
                  <td className="py-2.5 pr-4">{formatMicroUsd(m.settledMicroUsd)}</td>
                  <td className="py-2.5 pr-4 text-rose-400">{m.ghostOrGarbageCount}</td>
                  <td className="py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        m.reliabilityPct < 80
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {m.reliabilityPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Forensic Alerts Triage Inbox */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Forensic Alerts Inbox ({alerts.length})
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">
            Powered by Vercel Workflow createHook / resumeHook
          </span>
        </div>

        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
            >
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                      {alert.alertType}
                    </span>
                    <span className="text-zinc-400">{alert.traceId}</span>
                    <span className="text-rose-300">
                      -{formatMicroUsd(alert.wastedMicroUsd)}
                    </span>
                    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300">
                      {alert.triageStatus}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-200">{alert.summary}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {alert.triageStatus !== "ACKNOWLEDGED" && (
                  <button
                    type="button"
                    disabled={busyId === alert.id}
                    onClick={() => void triage(alert.id, "ACKNOWLEDGED")}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                  >
                    Acknowledge
                  </button>
                )}
                {alert.triageStatus !== "MERCHANT_FLAGGED" && (
                  <button
                    type="button"
                    disabled={busyId === alert.id}
                    onClick={() => void triage(alert.id, "MERCHANT_FLAGGED")}
                    className="rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-500/25"
                  >
                    Flag Merchant
                  </button>
                )}
                {alert.triageStatus !== "RESOLVED" && (
                  <button
                    type="button"
                    disabled={busyId === alert.id}
                    onClick={() => void triage(alert.id, "RESOLVED")}
                    className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/25"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys */}
      <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-zinc-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Ingest & MCP API Keys
          </h2>
        </div>

        <form onSubmit={(e) => void createKey(e)} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key label (e.g. prod-trading-agent)"
            className="flex-1 min-w-[220px] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:border-zinc-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Key
          </button>
        </form>

        {createdPlaintext && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/20 px-3 py-2 font-mono text-xs">
            <span className="text-emerald-200 break-all">{createdPlaintext}</span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(createdPlaintext);
                setCopiedKey(true);
                setTimeout(() => setCopiedKey(false), 1500);
              }}
              className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200"
            >
              {copiedKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedKey ? "Copied" : "Copy Once"}
            </button>
          </div>
        )}

        <div className="divide-y divide-zinc-800/70">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between py-2.5 text-xs"
            >
              <div className="space-y-0.5">
                <div className="font-medium text-zinc-200">
                  {k.name}{" "}
                  {k.revokedAt && (
                    <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                      REVOKED
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-zinc-500">{k.keyPrefix}</div>
              </div>
              {!k.revokedAt && (
                <button
                  type="button"
                  onClick={() => void revokeKey(k.id)}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:border-rose-500/50 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
