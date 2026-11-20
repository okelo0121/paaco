import { describe, expect, it, vi } from "vitest";
import { analyzeTraceForensics, SOLANA_DEVNET_CAIP2, type IngestBatchRequest } from "@paaco/shared";
import { createPaacoTracer } from "../tracer.js";

describe("@paaco/sdk PaacoTracer", () => {
  it("captures nested LLM -> MCP -> x402 payment spans and detects a Ghost Payment", async () => {
    const capturedBatches: IngestBatchRequest[] = [];

    const transportFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBatches.push(JSON.parse(String(init?.body)) as IngestBatchRequest);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const tracer = createPaacoTracer({
      apiKey: "paaco_test_key",
      agentId: "arb-agent",
      endpoint: "https://paaco.test",
      transportFetch,
    });

    // Simulate a downstream x402 merchant returning 402 then settling on-chain before 504 timeout
    let callNum = 0;
    const mockMerchantFetch = vi.fn(async () => {
      callNum += 1;
      if (callNum === 1) {
        const challenge = Buffer.from(
          JSON.stringify({
            accepts: [
              {
                network: SOLANA_DEVNET_CAIP2,
                amount: "250000",
                asset: "USDC",
                payTo: "SolOracle111",
              },
            ],
          }),
        ).toString("base64");
        return new Response("Payment Required", {
          status: 402,
          headers: { "payment-required": challenge },
        });
      }

      const receipt = Buffer.from(
        JSON.stringify({
          txHash: "5solGhostSig999",
          network: SOLANA_DEVNET_CAIP2,
          amount: "250000",
          payTo: "SolOracle111",
          success: true,
        }),
      ).toString("base64");

      return new Response("Gateway Timeout", {
        status: 504,
        headers: { "payment-response": receipt },
      });
    }) as unknown as typeof fetch;

    const tracedFetch = tracer.wrapFetch(mockMerchantFetch);
    const mcp = tracer.wrapMcpClient(
      {
        async callTool() {
          const r1 = await tracedFetch("https://oracle.dev/feed");
          expect(r1.status).toBe(402);
          const r2 = await tracedFetch("https://oracle.dev/feed", {
            headers: { "payment-signature": "mock_signed_tx" },
          });
          return { status: r2.status };
        },
      },
      "oracle-mcp",
    );

    const outcome = await tracer.runTrace(
      { userPrompt: "Check live SOL spread", userId: "usr_1" },
      async () => {
        tracer.recordLlmStep({
          model: "anthropic/claude-haiku-4.5",
          inputTokens: 800,
          outputTokens: 120,
          costMicroUsd: 1920,
        });
        return mcp.callTool({ name: "get_quote", arguments: { pair: "SOL/USDC" } });
      },
    );

    expect(outcome).toEqual({ status: 504 });
    expect(capturedBatches).toHaveLength(1);
    const batch = capturedBatches[0]!;
    expect(batch.traces[0]?.agentId).toBe("arb-agent");
    expect(batch.spans).toHaveLength(4); // llm, 402 quote, 504 pay, mcp parent

    const mcpSpan = batch.spans.find((s) => s.kind === "mcp_tool");
    const paySpan = batch.spans.find(
      (s) => s.kind === "http_payment" && s.payment?.settlementStatus === "ghost_payment",
    );
    expect(mcpSpan).toBeDefined();
    expect(paySpan?.parentSpanId).toBe(mcpSpan?.spanId);
    expect(paySpan?.payment?.txHash).toBe("5solGhostSig999");

    const { summary } = analyzeTraceForensics(batch.spans);
    expect(summary.ghostCount).toBe(1);
    expect(summary.wastedMicroUsd).toBe(250_000);
  });

  it("never breaks caller agent execution when telemetry ingest endpoint fails", async () => {
    const errors: unknown[] = [];
    const failingTransport = vi.fn(async () => {
      throw new Error("Network down");
    }) as unknown as typeof fetch;

    const tracer = createPaacoTracer({
      apiKey: "paaco_test_key",
      agentId: "safe-agent",
      endpoint: "https://paaco.test",
      transportFetch: failingTransport,
      onError: (err) => errors.push(err),
    });

    const result = await tracer.runTrace({ userPrompt: "Hello" }, async () => {
      tracer.recordLlmStep({
        model: "openai/gpt-5.4-mini",
        inputTokens: 100,
        outputTokens: 20,
        costMicroUsd: 270,
      });
      return "agent-succeeded";
    });

    expect(result).toBe("agent-succeeded");
    expect(errors).toHaveLength(1);
  });
});
