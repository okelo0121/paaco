import {
  TraceFilterSchema,
  formatMicroUsd,
  type TraceFilter,
} from "@paaco/shared";
import type { TraceRepository } from "../../db/repository";
import { runNaturalLanguageLogSearch } from "../log-finder/query-engine";

export async function handleSearchPaymentTraces(
  repo: TraceRepository,
  projectId: string,
  args: {
    query?: string;
    agentId?: string;
    network?: string;
    alertType?: TraceFilter["alertType"];
    onlyAnomalies?: boolean;
    limit?: number;
  },
) {
  if (args.query && args.query.trim().length > 0) {
    const res = await runNaturalLanguageLogSearch(repo, projectId, args.query);
    return {
      mode: res.mode,
      summary: res.summary,
      appliedFilter: res.appliedFilter,
      totalMatched: res.totalMatched,
      totalWastedUsd: formatMicroUsd(res.totalWastedMicroUsd),
      traces: res.traces.map((t) => ({
        traceId: t.id,
        agentId: t.agentId,
        userId: t.userId,
        userPrompt: t.userPrompt,
        totalUsd: formatMicroUsd(t.totalMicroUsd),
        llmTokenUsd: formatMicroUsd(t.llmTokenMicroUsd),
        toolPaymentUsd: formatMicroUsd(t.toolPaymentMicroUsd),
        wastedUsd: formatMicroUsd(t.wastedMicroUsd),
        anomalyCount: t.anomalyCount,
        startedAt: t.startedAt,
      })),
    };
  }

  const parsed = TraceFilterSchema.parse({
    agentId: args.agentId,
    network: args.network,
    alertType: args.alertType,
    onlyAnomalies: args.onlyAnomalies,
    limit: args.limit ?? 20,
  });

  const traces = await repo.listTraces(projectId, parsed);
  return {
    mode: "structured" as const,
    totalMatched: traces.length,
    traces: traces.map((t) => ({
      traceId: t.id,
      agentId: t.agentId,
      userPrompt: t.userPrompt,
      totalUsd: formatMicroUsd(t.totalMicroUsd),
      wastedUsd: formatMicroUsd(t.wastedMicroUsd),
      anomalyCount: t.anomalyCount,
      startedAt: t.startedAt,
    })),
  };
}

export async function handleInspectTraceFlamegraph(
  repo: TraceRepository,
  projectId: string,
  args: { traceId: string },
) {
  const detail = await repo.getTraceDetail(projectId, args.traceId);
  if (!detail) {
    return { found: false, error: `Trace ${args.traceId} not found` };
  }

  return {
    found: true,
    trace: {
      id: detail.trace.id,
      agentId: detail.trace.agentId,
      userId: detail.trace.userId,
      userPrompt: detail.trace.userPrompt,
      durationMs: detail.trace.durationMs,
      totalUsd: formatMicroUsd(detail.trace.totalMicroUsd),
      llmTokenUsd: formatMicroUsd(detail.trace.llmTokenMicroUsd),
      toolPaymentUsd: formatMicroUsd(detail.trace.toolPaymentMicroUsd),
      wastedUsd: formatMicroUsd(detail.trace.wastedMicroUsd),
    },
    alerts: detail.alerts.map((a) => ({
      id: a.id,
      alertType: a.alertType,
      severity: a.severity,
      wastedUsd: formatMicroUsd(a.wastedMicroUsd),
      summary: a.summary,
      triageStatus: a.triageStatus,
    })),
    spans: detail.spans.map((s) => ({
      spanId: s.id,
      parentSpanId: s.parentSpanId,
      kind: s.kind,
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      costUsd: formatMicroUsd(s.costMicroUsd),
      wastedUsd: formatMicroUsd(s.wastedMicroUsd),
      network: s.network,
      merchantDomain: s.merchantDomain,
      httpStatus: s.httpStatus,
      txHash: s.txHash,
      explorerUrl: s.explorerUrl,
      reconciliationStatus: s.reconciliationStatus,
      errorMessage: s.errorMessage,
    })),
  };
}

export async function handleListGhostPayments(
  repo: TraceRepository,
  projectId: string,
  args: { includeAllAnomalies?: boolean; limit?: number },
) {
  const alerts = await repo.listAlerts(projectId);
  const filtered = alerts
    .filter((a) => (args.includeAllAnomalies ? true : a.alertType === "GHOST_PAYMENT"))
    .slice(0, args.limit ?? 20);

  const items = await Promise.all(
    filtered.map(async (alert) => {
      const detail = await repo.getTraceDetail(projectId, alert.traceId);
      const span = detail?.spans.find((s) => s.id === alert.spanId);
      return {
        alertId: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        triageStatus: alert.triageStatus,
        traceId: alert.traceId,
        agentId: detail?.trace.agentId,
        merchantDomain: span?.merchantDomain,
        merchantUrl: span?.merchantUrl,
        network: span?.network,
        httpStatus: span?.httpStatus,
        txHash: span?.txHash,
        explorerUrl: span?.explorerUrl,
        wastedUsd: formatMicroUsd(alert.wastedMicroUsd),
        summary: alert.summary,
      };
    }),
  );

  return {
    count: items.length,
    incidents: items,
  };
}

export async function handleGetAgentUnitEconomics(
  repo: TraceRepository,
  projectId: string,
) {
  const report = await repo.getUnitEconomics(projectId);
  return {
    totals: {
      traceCount: report.totals.traceCount,
      totalUsd: formatMicroUsd(report.totals.totalMicroUsd),
      llmTokenUsd: formatMicroUsd(report.totals.llmTokenMicroUsd),
      toolPaymentUsd: formatMicroUsd(report.totals.toolPaymentMicroUsd),
      wastedUsd: formatMicroUsd(report.totals.wastedMicroUsd),
      openAlertCount: report.totals.openAlertCount,
    },
    byAgent: report.byAgent.map((a) => ({
      agentId: a.agentId,
      traceCount: a.traceCount,
      anomalyTraceCount: a.anomalyTraceCount,
      totalUsd: formatMicroUsd(a.totalMicroUsd),
      llmTokenUsd: formatMicroUsd(a.llmTokenMicroUsd),
      toolPaymentUsd: formatMicroUsd(a.toolPaymentMicroUsd),
      wastedUsd: formatMicroUsd(a.wastedMicroUsd),
      wasteRatePct: a.wasteRatePct,
    })),
    merchantLeaderboard: report.byMerchant.map((m) => ({
      merchantDomain: m.merchantDomain,
      network: m.network,
      paidCallCount: m.paidCallCount,
      settledUsd: formatMicroUsd(m.settledMicroUsd),
      ghostOrGarbageCount: m.ghostOrGarbageCount,
      wastedUsd: formatMicroUsd(m.wastedMicroUsd),
      reliabilityPct: m.reliabilityPct,
    })),
  };
}
