import { createPaacoTracer } from "@paaco/sdk";
import {
  BASE_SEPOLIA_CAIP2,
  IngestBatchRequestSchema,
  SOLANA_DEVNET_CAIP2,
  type IngestBatchRequest,
} from "@paaco/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/db/repository";
import { DEMO_API_KEY, DEMO_PROJECT_ID } from "@/db/seed-data";
import {
  handleDemoMerchantRequest,
  type DemoScenario,
} from "@/lib/demo-merchants";
import { triggerReconcileWorkflow } from "@/lib/workflows/reconcile-workflow";

const RunAgentBodySchema = z.object({
  scenario: z.enum(["clean-quote", "ghost-timeout", "flaky-loop", "empty-payload"]),
  chain: z.enum(["solana", "base"]).default("solana"),
});

const SCENARIO_META: Record<
  DemoScenario,
  {
    agentId: string;
    prompt: string;
    mcpServer: string;
    mcpTool: string;
    merchantHost: string;
  }
> = {
  "clean-quote": {
    agentId: "arb-liquidity-agent",
    prompt: "Fetch verified pool spread quote and summarize net arbitrage edge.",
    mcpServer: "pyth-oracle",
    mcpTool: "get_pool_spread",
    merchantHost: "quotes.pyth-demo.dev",
  },
  "ghost-timeout": {
    agentId: "arb-liquidity-agent",
    prompt: "Pull deep orderbook snapshot — retry once if upstream gateway times out.",
    mcpServer: "pyth-oracle",
    mcpTool: "get_orderbook_depth",
    merchantHost: "oracle.solana-depth.io",
  },
  "flaky-loop": {
    agentId: "sec-research-agent",
    prompt: "Poll contract AST decompiler until ready and report bytecode provenance.",
    mcpServer: "evm-trace",
    mcpTool: "fetch_decompiled_ast",
    merchantHost: "ast.evmintel.xyz",
  },
  "empty-payload": {
    agentId: "macro-brief-agent",
    prompt: "Download Q3 stablecoin institutional flow dataset and extract net inflows.",
    mcpServer: "macro-data",
    mcpTool: "download_q3_flows",
    merchantHost: "reports.alpha-feed.org",
  },
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RunAgentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scenario or chain" }, { status: 400 });
  }

  const { scenario, chain } = parsed.data;
  const meta = SCENARIO_META[scenario];
  const network = chain === "base" ? BASE_SEPOLIA_CAIP2 : SOLANA_DEVNET_CAIP2;
  const repo = getRepository();

  let capturedTraceId: string | undefined;
  let capturedAlertsCount = 0;

  // Use the real @paaco/sdk PaacoTracer!
  const tracer = createPaacoTracer({
    apiKey: DEMO_API_KEY,
    agentId: meta.agentId,
    endpoint: "http://in-process.paaco",
    transportFetch: async (_url, init) => {
      const batch = IngestBatchRequestSchema.parse(
        JSON.parse(String(init?.body)) as IngestBatchRequest,
      );
      const outcome = await repo.ingestBatch(DEMO_PROJECT_ID, batch);
      capturedTraceId = outcome.traceIds[0];
      capturedAlertsCount = outcome.alertsCreated.length;
      for (const tId of outcome.traceIds) {
        const primaryAlert = outcome.alertsCreated.find((a) => a.traceId === tId);
        await triggerReconcileWorkflow({
          traceId: tId,
          projectId: DEMO_PROJECT_ID,
          primaryAlertId: primaryAlert?.id,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  // Simulated x402 client invoking our built-in HTTP 402 demo merchants in-process
  const inProcessMerchantFetch: typeof fetch = async (input, init) => {
    const reqUrl = typeof input === "string" ? input : input.toString();
    const req = new Request(reqUrl, init);
    return handleDemoMerchantRequest(scenario, req, network);
  };

  const tracedFetch = tracer.wrapFetch(inProcessMerchantFetch);

  const payOnce = async (attempt: number) => {
    const merchantUrl = `https://${meta.merchantHost}/api/demo-merchants/${scenario}?network=${encodeURIComponent(network)}`;
    const quoteRes = await tracedFetch(merchantUrl, { method: "GET" });
    if (quoteRes.status === 402) {
      return tracedFetch(merchantUrl, {
        method: "GET",
        headers: {
          "payment-signature": `demo_signed_${chain}_attempt_${attempt}`,
          "x-attempt": String(attempt),
        },
      });
    }
    return quoteRes;
  };

  const mcp = tracer.wrapMcpClient(
    {
      async callTool() {
        if (scenario === "ghost-timeout") {
          const r1 = await payOnce(1);
          // Agent retries blindly after 504 timeout -> double-pays!
          const r2 = r1.status === 504 ? await payOnce(2) : r1;
          return { firstStatus: r1.status, retryStatus: r2.status };
        }
        if (scenario === "flaky-loop") {
          const statuses: number[] = [];
          for (let i = 1; i <= 4; i++) {
            const r = await payOnce(i);
            statuses.push(r.status);
          }
          return { loopCalls: statuses.length, statuses };
        }
        const r = await payOnce(1);
        return { status: r.status };
      },
    },
    meta.mcpServer,
  );

  await tracer.runTrace(
    {
      userPrompt: meta.prompt,
      userId: "usr_judge_live",
      sessionId: `live_${Date.now().toString(36)}`,
      isDemo: true,
    },
    async () => {
      tracer.recordLlmStep({
        model: "anthropic/claude-haiku-4.5",
        name: "llm.claude-haiku-4.5 (plan)",
        inputTokens: 1180,
        outputTokens: 240,
        durationMs: 320,
      });

      await mcp.callTool({
        name: meta.mcpTool,
        arguments: { chain, scenario },
      });

      tracer.recordLlmStep({
        model: "anthropic/claude-haiku-4.5",
        name: "llm.claude-haiku-4.5 (synthesize)",
        inputTokens: 890,
        outputTokens: 190,
        durationMs: 260,
      });
    },
  );

  const detail = capturedTraceId
    ? await repo.getTraceDetail(DEMO_PROJECT_ID, capturedTraceId)
    : null;

  return NextResponse.json({
    ok: true,
    traceId: capturedTraceId,
    alertsCreated: capturedAlertsCount,
    detail,
  });
}
