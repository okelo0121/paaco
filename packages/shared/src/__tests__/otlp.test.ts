import { describe, expect, it } from "vitest";
import { SOLANA_DEVNET_CAIP2 } from "../networks.js";
import { parseOtlpTracesRequest } from "../otlp.js";

describe("parseOtlpTracesRequest", () => {
  it("converts OTLP GenAI, MCP, and x402 spans preserving hierarchy", () => {
    const otlpBody = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "arb-bot" } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "otel_trace_1",
                  spanId: "span_llm_1",
                  name: "ai.generateText",
                  startTimeUnixNano: "1763550000000000000",
                  endTimeUnixNano: "1763550001000000000",
                  attributes: [
                    { key: "gen_ai.request.model", value: { stringValue: "anthropic/claude-haiku-4.5" } },
                    { key: "gen_ai.usage.input_tokens", value: { intValue: "1000" } },
                    { key: "gen_ai.usage.output_tokens", value: { intValue: "250" } },
                    { key: "paaco.user_prompt", value: { stringValue: "Check SOL/USDC arbitrage" } },
                  ],
                },
                {
                  traceId: "otel_trace_1",
                  spanId: "span_mcp_1",
                  parentSpanId: "span_llm_1",
                  name: "mcp.callTool",
                  startTimeUnixNano: "1763550000200000000",
                  endTimeUnixNano: "1763550000900000000",
                  attributes: [
                    { key: "mcp.server.name", value: { stringValue: "dex-tools" } },
                    { key: "mcp.tool.name", value: { stringValue: "fetch_orderbook" } },
                    { key: "mcp.response.bytes", value: { intValue: 320 } },
                  ],
                },
                {
                  traceId: "otel_trace_1",
                  spanId: "span_pay_1",
                  parentSpanId: "span_mcp_1",
                  name: "x402.fetch",
                  startTimeUnixNano: "1763550000300000000",
                  endTimeUnixNano: "1763550000800000000",
                  status: { code: 2, message: "504 Gateway Timeout" },
                  attributes: [
                    { key: "x402.network", value: { stringValue: SOLANA_DEVNET_CAIP2 } },
                    { key: "x402.amount_micro_usd", value: { intValue: 150000 } },
                    { key: "x402.pay_to", value: { stringValue: "SolMer111" } },
                    { key: "x402.tx_hash", value: { stringValue: "5solTxOtel1" } },
                    { key: "url.full", value: { stringValue: "https://dex.api/orderbook" } },
                    { key: "http.response.status_code", value: { intValue: 504 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const batch = parseOtlpTracesRequest(otlpBody);
    expect(batch.traces).toHaveLength(1);
    expect(batch.traces[0]?.agentId).toBe("arb-bot");
    expect(batch.traces[0]?.userPrompt).toBe("Check SOL/USDC arbitrage");
    expect(batch.spans).toHaveLength(3);

    const [llm, mcp, pay] = batch.spans;
    expect(llm?.kind).toBe("llm");
    expect(llm?.llm?.costMicroUsd).toBe(3000);
    expect(mcp?.kind).toBe("mcp_tool");
    expect(mcp?.parentSpanId).toBe("span_llm_1");
    expect(pay?.kind).toBe("http_payment");
    expect(pay?.parentSpanId).toBe("span_mcp_1");
    expect(pay?.status).toBe("timeout");
    expect(pay?.payment?.settlementStatus).toBe("ghost_payment");
    expect(pay?.payment?.merchantDomain).toBe("dex.api");
  });
});
