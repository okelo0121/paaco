import type { TriageStatus } from "@paaco/shared";
import { createHook, sleep } from "workflow";
import { start } from "workflow/api";
import {
  applyTriageDecisionStep,
  dispatchAnomalyWebhookStep,
  persistAlertWorkflowInfoStep,
  verifyTracePaymentsStep,
} from "./reconcile-steps";

export interface TriageDecisionPayload {
  status: TriageStatus;
  note?: string;
}

export async function reconcileTraceWorkflow(input: {
  traceId: string;
  projectId: string;
  primaryAlertId?: string;
}) {
  "use workflow";

  await verifyTracePaymentsStep(input.traceId, input.projectId);
  await dispatchAnomalyWebhookStep(input.traceId, input.projectId);

  if (!input.primaryAlertId) {
    return { reconciled: true, triaged: false };
  }

  using hook = createHook<TriageDecisionPayload>();
  await persistAlertWorkflowInfoStep(input.primaryAlertId, undefined, hook.token);

  const outcome = await Promise.race([
    hook.then((decision) => ({ type: "decided" as const, decision })),
    sleep("24h").then(() => ({ type: "timeout" as const })),
  ]);

  if (outcome.type === "decided") {
    await applyTriageDecisionStep(
      input.primaryAlertId,
      outcome.decision.status,
      outcome.decision.note,
    );
    return { reconciled: true, triaged: true, status: outcome.decision.status };
  }

  return { reconciled: true, triaged: false, expired: true };
}

/**
 * Triggers the durable Vercel Workflow for a newly ingested trace, falling back gracefully
 * to direct step execution when invoked outside a Next.js workflow runtime (e.g. unit tests).
 */
export async function triggerReconcileWorkflow(input: {
  traceId: string;
  projectId: string;
  primaryAlertId?: string;
}): Promise<{ workflowRunId?: string; mode: "workflow" | "direct" }> {
  try {
    const run = await start(reconcileTraceWorkflow, [input]);
    if (input.primaryAlertId && run?.runId) {
      await persistAlertWorkflowInfoStep(input.primaryAlertId, run.runId, undefined);
    }
    return { workflowRunId: run?.runId, mode: "workflow" };
  } catch {
    await verifyTracePaymentsStep(input.traceId, input.projectId);
    await dispatchAnomalyWebhookStep(input.traceId, input.projectId);
    return { mode: "direct" };
  }
}
