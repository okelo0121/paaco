import { formatMicroUsd, type TriageStatus } from "@paaco/shared";
import { getRepository } from "../../db/repository";
import { verifySpanSettlement } from "../reconcile/chains";

export async function verifyTracePaymentsStep(traceId: string, projectId: string) {
  "use step";
  const repo = getRepository();
  const detail = await repo.getTraceDetail(projectId, traceId);
  if (!detail) return { verifiedCount: 0 };

  let verifiedCount = 0;
  for (const span of detail.spans) {
    if (span.kind !== "http_payment" || !span.txHash) continue;
    const outcome = await verifySpanSettlement({
      network: span.network,
      txHash: span.txHash,
      amountMicroUsd: span.costMicroUsd,
      payTo: span.payTo,
    });
    await repo.updateSpanReconciliation(span.id, outcome);
    verifiedCount += 1;
  }
  return { verifiedCount };
}

export async function persistAlertWorkflowInfoStep(
  alertId: string,
  workflowRunId?: string,
  workflowHookToken?: string,
) {
  "use step";
  const repo = getRepository();
  await repo.setAlertWorkflowInfo(alertId, { workflowRunId, workflowHookToken });
}

export async function dispatchAnomalyWebhookStep(traceId: string, projectId: string) {
  "use step";
  const webhookUrl = process.env.PAACO_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return { dispatched: false };

  const repo = getRepository();
  const detail = await repo.getTraceDetail(projectId, traceId);
  if (!detail || !detail.trace.hasAnomalies) return { dispatched: false };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "paaco.forensic_anomaly",
        traceId: detail.trace.id,
        agentId: detail.trace.agentId,
        wastedUsd: formatMicroUsd(detail.trace.wastedMicroUsd),
        alerts: detail.alerts.map((a) => ({
          id: a.id,
          type: a.alertType,
          severity: a.severity,
          summary: a.summary,
        })),
      }),
    });
    return { dispatched: true };
  } catch {
    return { dispatched: false };
  }
}

export async function applyTriageDecisionStep(
  alertId: string,
  status: TriageStatus,
  note?: string,
) {
  "use step";
  const repo = getRepository();
  await repo.triageAlert(alertId, { status, note });
}
