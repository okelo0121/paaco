import { formatMicroUsd } from "@paaco/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/db/repository";
import { createGatewayTextStreamResponse } from "@/lib/ai/stream";
import { resolveRequestProjectId } from "@/lib/api-auth";

const StreamRequestSchema = z.object({
  prompt: z.string().max(1500).optional(),
  traceId: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
});

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY?.trim() && !process.env.VERCEL_OIDC_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "AI Gateway credentials (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN) are not configured." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = StreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stream request" }, { status: 400 });
  }

  let traceSummary: string | undefined;
  let prompt = parsed.data.prompt?.trim() ?? "";

  if (parsed.data.traceId) {
    const projectId = await resolveRequestProjectId(request);
    const repo = getRepository();
    const detail = await repo.getTraceDetail(projectId, parsed.data.traceId);
    if (!detail) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }

    const { trace, spans, alerts } = detail;
    traceSummary = JSON.stringify(
      {
        traceId: trace.id,
        agentId: trace.agentId,
        userPrompt: trace.userPrompt,
        totalUsd: formatMicroUsd(trace.totalMicroUsd),
        llmTokenUsd: formatMicroUsd(trace.llmTokenMicroUsd),
        toolPaymentUsd: formatMicroUsd(trace.toolPaymentMicroUsd),
        wastedUsd: formatMicroUsd(trace.wastedMicroUsd),
        alerts: alerts.map((a) => ({
          type: a.alertType,
          severity: a.severity,
          wastedUsd: formatMicroUsd(a.wastedMicroUsd),
          summary: a.summary,
        })),
        paymentSpans: spans
          .filter((s) => s.kind === "http_payment")
          .map((s) => ({
            name: s.name,
            network: s.network,
            httpStatus: s.httpStatus,
            settlementStatus: s.settlementStatus,
            costUsd: formatMicroUsd(s.costMicroUsd),
            txHash: s.txHash,
            errorMessage: s.errorMessage,
          })),
      },
      null,
      2,
    );

    if (!prompt) {
      prompt = `Diagnose wasted spend and anomalies in agent trace ${trace.id} (${trace.agentId}).`;
    }
  }

  if (!prompt) {
    prompt = "Explain in two short sentences how Paaco correlates LLM tokens, MCP calls, and x402 settlements to detect ghost payments.";
  }

  return await createGatewayTextStreamResponse({
    prompt,
    traceSummary,
    model: parsed.data.model,
  });
}
