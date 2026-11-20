import { describe, expect, it } from "vitest";
import { analyzeTraceForensics } from "../forensics.js";
import { BASE_SEPOLIA_CAIP2, SOLANA_DEVNET_CAIP2 } from "../networks.js";
import type { SpanInput } from "../trace-schema.js";

function baseSpan(overrides: Partial<SpanInput>): SpanInput {
  return {
    spanId: "sp_1",
    traceId: "tr_1",
    kind: "http_payment",
    name: "x402.fetch",
    startedAt: "2026-11-19T12:00:00.000Z",
    endedAt: "2026-11-19T12:00:01.000Z",
    status: "ok",
    ...overrides,
  };
}

describe("analyzeTraceForensics", () => {
  it("detects Ghost Payments when on-chain settlement succeeded before a 504/timeout", () => {
    const spans: SpanInput[] = [
      baseSpan({
        spanId: "sp_llm",
        kind: "llm",
        name: "claude-haiku-4.5",
        llm: {
          model: "anthropic/claude-haiku-4.5",
          inputTokens: 1000,
          outputTokens: 200,
          reasoningTokens: 0,
          costMicroUsd: 2_700,
        },
      }),
      baseSpan({
        spanId: "sp_pay_ghost",
        status: "timeout",
        payment: {
          rail: "x402_solana",
          network: SOLANA_DEVNET_CAIP2,
          asset: "USDC",
          amountMicroUsd: 200_000,
          payTo: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
          merchantUrl: "https://oracle.example.com/quote",
          merchantDomain: "oracle.example.com",
          httpStatus: 504,
          txHash: "5k3vSolanaSigMock111",
          settlementStatus: "settled",
        },
      }),
    ];

    const { alerts, summary } = analyzeTraceForensics(spans);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alertType).toBe("GHOST_PAYMENT");
    expect(alerts[0]?.wastedMicroUsd).toBe(200_000);
    expect(summary.ghostCount).toBe(1);
    expect(summary.wastedMicroUsd).toBe(200_000);
    expect(summary.llmTokenMicroUsd).toBe(2_700);
    expect(summary.toolPaymentMicroUsd).toBe(200_000);
    expect(summary.totalMicroUsd).toBe(202_700);
  });

  it("detects Loop Burn on >= 3 paid calls to the same endpoint and avoids double-counting", () => {
    const spans: SpanInput[] = [1, 2, 3, 4].map((i) =>
      baseSpan({
        spanId: `sp_${i}`,
        startedAt: `2026-11-19T12:00:0${i}.000Z`,
        endedAt: `2026-11-19T12:00:0${i}.500Z`,
        status: "ok",
        payment: {
          rail: "x402_evm",
          network: BASE_SEPOLIA_CAIP2,
          asset: "USDC",
          amountMicroUsd: 100_000,
          payTo: "0x1111111111111111111111111111111111111111",
          merchantUrl: "https://api.loop.dev/v1/infer",
          merchantDomain: "api.loop.dev",
          httpStatus: 200,
          txHash: `0xabc${i}`,
          settlementStatus: "settled",
          responseBytes: 240,
        },
      }),
    );

    const { alerts, summary } = analyzeTraceForensics(spans);
    expect(summary.loopCount).toBe(3);
    expect(alerts.every((a) => a.alertType === "LOOP_BURN")).toBe(true);
    expect(summary.toolPaymentMicroUsd).toBe(400_000);
    expect(summary.wastedMicroUsd).toBe(300_000);
  });

  it("detects Garbage Delivery when a settled HTTP 200 returns tiny or HTML-error payloads", () => {
    const spans: SpanInput[] = [
      baseSpan({
        spanId: "sp_tiny",
        payment: {
          rail: "x402_solana",
          network: SOLANA_DEVNET_CAIP2,
          asset: "USDC",
          amountMicroUsd: 350_000,
          payTo: "Dest111",
          merchantUrl: "https://data.bad.io/report",
          merchantDomain: "data.bad.io",
          httpStatus: 200,
          txHash: "sig_bad_1",
          settlementStatus: "settled",
          responseBytes: 2,
          responsePreview: "{}",
        },
      }),
      baseSpan({
        spanId: "sp_html",
        payment: {
          rail: "x402_evm",
          network: BASE_SEPOLIA_CAIP2,
          asset: "USDC",
          amountMicroUsd: 150_000,
          payTo: "0x2222",
          merchantUrl: "https://cdn.bad.io/feed",
          merchantDomain: "cdn.bad.io",
          httpStatus: 200,
          txHash: "0xbad2",
          settlementStatus: "settled",
          responseBytes: 512,
          responsePreview: "<!DOCTYPE html><html>502 Bad Gateway</html>",
        },
      }),
    ];

    const { summary } = analyzeTraceForensics(spans);
    expect(summary.garbageCount).toBe(2);
    expect(summary.wastedMicroUsd).toBe(500_000);
  });

  it("produces zero alerts on a healthy multi-span paid trace", () => {
    const spans: SpanInput[] = [
      baseSpan({
        spanId: "sp_llm",
        kind: "llm",
        name: "gpt-step",
        llm: {
          model: "openai/gpt-5.4-mini",
          inputTokens: 500,
          outputTokens: 150,
          reasoningTokens: 0,
          costMicroUsd: 1_500,
        },
      }),
      baseSpan({
        spanId: "sp_mcp",
        parentSpanId: "sp_llm",
        kind: "mcp_tool",
        name: "mcp.market_quote",
        mcp: {
          serverName: "pyth-mcp",
          toolName: "get_spread",
          responseBytes: 420,
          isEmptyOrError: false,
        },
      }),
      baseSpan({
        spanId: "sp_pay",
        parentSpanId: "sp_mcp",
        payment: {
          rail: "x402_solana",
          network: SOLANA_DEVNET_CAIP2,
          asset: "USDC",
          amountMicroUsd: 50_000,
          payTo: "Market111",
          merchantUrl: "https://quotes.pyth.example/sol-usdc",
          merchantDomain: "quotes.pyth.example",
          httpStatus: 200,
          txHash: "sig_clean_1",
          settlementStatus: "settled",
          responseBytes: 420,
          responsePreview: "{\"pair\":\"SOL/USDC\",\"price\":184.22}",
        },
      }),
    ];

    const { alerts, summary } = analyzeTraceForensics(spans);
    expect(alerts).toHaveLength(0);
    expect(summary.wastedMicroUsd).toBe(0);
    expect(summary.settledCount).toBe(1);
    expect(summary.totalMicroUsd).toBe(51_500);
  });
});
