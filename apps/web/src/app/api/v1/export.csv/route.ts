import { formatMicroUsd } from "@paaco/shared";
import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";

function csvCell(val: unknown): string {
  const str = val === undefined || val === null ? "" : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const traces = await repo.listTraces(projectId, { limit: 100 });

  const header = [
    "started_at",
    "trace_id",
    "agent_id",
    "user_id",
    "span_id",
    "kind",
    "network",
    "merchant_domain",
    "http_status",
    "llm_usd",
    "payment_usd",
    "wasted_usd",
    "settlement_status",
    "reconciliation_status",
    "tx_hash",
    "explorer_url",
  ].join(",");

  const rows: string[] = [header];

  for (const trace of traces) {
    const detail = await repo.getTraceDetail(projectId, trace.id);
    if (!detail) continue;

    for (const span of detail.spans) {
      const llmUsd = span.kind === "llm" ? formatMicroUsd(span.costMicroUsd) : "$0.00";
      const payUsd = span.kind === "http_payment" ? formatMicroUsd(span.costMicroUsd) : "$0.00";
      const wasteUsd = formatMicroUsd(span.wastedMicroUsd);

      rows.push(
        [
          csvCell(span.startedAt),
          csvCell(trace.id),
          csvCell(trace.agentId),
          csvCell(trace.userId ?? ""),
          csvCell(span.externalSpanId),
          csvCell(span.kind),
          csvCell(span.network ?? ""),
          csvCell(span.merchantDomain ?? ""),
          csvCell(span.httpStatus ?? ""),
          csvCell(llmUsd),
          csvCell(payUsd),
          csvCell(wasteUsd),
          csvCell(span.settlementStatus ?? ""),
          csvCell(span.reconciliationStatus ?? ""),
          csvCell(span.txHash ?? ""),
          csvCell(span.explorerUrl ?? ""),
        ].join(","),
      );
    }
  }

  return new NextResponse(rows.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="paaco-finops-reconciliation.csv"',
    },
  });
}
