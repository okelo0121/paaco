import { parseOtlpTracesRequest } from "@paaco/shared";
import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";
import { triggerReconcileWorkflow } from "@/lib/workflows/reconcile-workflow";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid OTLP JSON payload" }, { status: 400 });
  }

  const batch = parseOtlpTracesRequest(body);
  if (batch.spans.length === 0) {
    return NextResponse.json({ ok: true, ingestedSpans: 0, traceIds: [] });
  }

  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const outcome = await repo.ingestBatch(projectId, batch);

  for (const traceId of outcome.traceIds) {
    const primaryAlert = outcome.alertsCreated.find((a) => a.traceId === traceId);
    await triggerReconcileWorkflow({
      traceId,
      projectId,
      primaryAlertId: primaryAlert?.id,
    });
  }

  return NextResponse.json({
    ok: true,
    ingestedSpans: batch.spans.length,
    traceIds: outcome.traceIds,
    alertsCreated: outcome.alertsCreated.length,
  });
}
