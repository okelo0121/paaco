import { IngestBatchRequestSchema, TraceFilterSchema } from "@paaco/shared";
import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";
import { triggerReconcileWorkflow } from "@/lib/workflows/reconcile-workflow";

export async function GET(request: Request) {
  const projectId = await resolveRequestProjectId(request);
  const url = new URL(request.url);
  const parsed = TraceFilterSchema.safeParse({
    agentId: url.searchParams.get("agentId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
    network: url.searchParams.get("network") ?? undefined,
    alertType: url.searchParams.get("alertType") ?? undefined,
    onlyAnomalies: url.searchParams.get("onlyAnomalies") === "true" ? true : undefined,
    merchantDomain: url.searchParams.get("merchantDomain") ?? undefined,
    searchText: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 25,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid trace filter parameters", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const repo = getRepository();
  const traces = await repo.listTraces(projectId, parsed.data);
  return NextResponse.json({ traces });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = IngestBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ingest batch schema", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const outcome = await repo.ingestBatch(projectId, parsed.data);

  for (const traceId of outcome.traceIds) {
    const primaryAlert = outcome.alertsCreated.find((a) => a.traceId === traceId);
    await triggerReconcileWorkflow({
      traceId,
      projectId,
      primaryAlertId: primaryAlert?.id,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      traceIds: outcome.traceIds,
      alertsCreated: outcome.alertsCreated.length,
    },
    { status: 201 },
  );
}
