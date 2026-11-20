import { BASE_SEPOLIA_CAIP2, SOLANA_DEVNET_CAIP2, parseOtlpTracesRequest } from "@paaco/shared";
import { describe, expect, it, vi } from "vitest";
import { InMemoryTraceRepository } from "@/db/repository";
import { DEMO_PROJECT_ID } from "@/db/seed-data";
import { runNaturalLanguageLogSearch } from "@/lib/log-finder/query-engine";
import {
  handleGetAgentUnitEconomics,
  handleInspectTraceFlamegraph,
  handleListGhostPayments,
  handleSearchPaymentTraces,
} from "@/lib/mcp/tools";
import { verifyBaseSepoliaTx, verifySolanaDevnetTx } from "@/lib/reconcile/chains";

describe("Natural-Language Log Finder", () => {
  it("translates natural language forensic queries into accurate trace filters", async () => {
    const repo = new InMemoryTraceRepository();

    const ghostRes = await runNaturalLanguageLogSearch(
      repo,
      DEMO_PROJECT_ID,
      "Find ghost payments on Solana",
    );
    expect(ghostRes.mode).toBe("deterministic");
    expect(ghostRes.appliedFilter.alertType).toBe("GHOST_PAYMENT");
    expect(ghostRes.appliedFilter.network).toBe(SOLANA_DEVNET_CAIP2);
    expect(ghostRes.traces.length).toBeGreaterThanOrEqual(1);
    expect(ghostRes.traces.some((t) => t.id === "tr_seed_ghost_sol_01")).toBe(true);

    const loopRes = await runNaturalLanguageLogSearch(
      repo,
      DEMO_PROJECT_ID,
      "Show retry loops on Base over $0.25",
    );
    expect(loopRes.appliedFilter.alertType).toBe("LOOP_BURN");
    expect(loopRes.appliedFilter.network).toBe(BASE_SEPOLIA_CAIP2);
    expect(loopRes.appliedFilter.minWastedMicroUsd).toBe(250_000);
    expect(loopRes.traces.some((t) => t.id === "tr_seed_loop_base_02")).toBe(true);
  });
});

describe("On-chain Settlement Reconciliation", () => {
  it("verifies Solana Devnet transactions with maxSupportedTransactionVersion: 1", async () => {
    const mockFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        params: [string, { maxSupportedTransactionVersion?: number }];
      };
      expect(payload.params[1].maxSupportedTransactionVersion).toBe(1);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { slot: 412345678, meta: { err: null } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const ok = await verifySolanaDevnetTx("5realSolanaTxSignatureXYZ", 200_000, "Dest111", {
      fetchFn: mockFetch,
    });
    expect(ok.status).toBe("verified");
    expect(ok.explorerUrl).toContain("cluster=devnet");

    const sim = await verifySolanaDevnetTx("sim_demo123", 200_000);
    expect(sim.status).toBe("simulated");
  });

  it("verifies Base Sepolia receipts and detects reverted transactions", async () => {
    const validHash = `0x${"a".repeat(64)}`;
    const confirmed = await verifyBaseSepoliaTx(validHash, 100_000, "0x1", {
      getReceipt: async () => ({ status: "success", blockNumber: 1234567n }),
    });
    expect(confirmed.status).toBe("verified");
    expect(confirmed.explorerUrl).toBe(`https://sepolia.basescan.org/tx/${validHash}`);

    const reverted = await verifyBaseSepoliaTx(validHash, 100_000, "0x1", {
      getReceipt: async () => ({ status: "reverted", blockNumber: 1234568n }),
    });
    expect(reverted.status).toBe("mismatch");
  });
});

describe("Hosted MCP Tool Handlers & OTLP Ingestion", () => {
  it("exposes search, flamegraph inspection, ghost payment listing, and unit economics", async () => {
    const repo = new InMemoryTraceRepository();

    const search = await handleSearchPaymentTraces(repo, DEMO_PROJECT_ID, {
      query: "garbage deliveries",
    });
    expect(search.totalMatched).toBeGreaterThanOrEqual(1);

    const detail = await handleInspectTraceFlamegraph(repo, DEMO_PROJECT_ID, {
      traceId: "tr_seed_ghost_sol_01",
    });
    expect(detail.found).toBe(true);
    expect(detail.alerts?.some((a) => a.alertType === "GHOST_PAYMENT")).toBe(true);

    const ghosts = await handleListGhostPayments(repo, DEMO_PROJECT_ID, {
      includeAllAnomalies: false,
    });
    expect(ghosts.count).toBeGreaterThanOrEqual(1);

    const econ = await handleGetAgentUnitEconomics(repo, DEMO_PROJECT_ID);
    expect(econ.byAgent.length).toBeGreaterThanOrEqual(3);
    expect(econ.merchantLeaderboard.length).toBeGreaterThanOrEqual(3);

    // Verify OTLP ingest -> automatic forensic alert creation
    const otlpBatch = parseOtlpTracesRequest({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "otlp-test-agent" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "tr_otlp_test_99",
                  spanId: "sp_otlp_pay_1",
                  name: "x402.fetch",
                  startTimeUnixNano: "1763550000000000000",
                  endTimeUnixNano: "1763550001000000000",
                  status: { code: 2, message: "504 timeout" },
                  attributes: [
                    { key: "x402.network", value: { stringValue: SOLANA_DEVNET_CAIP2 } },
                    { key: "x402.amount_micro_usd", value: { intValue: 180000 } },
                    { key: "x402.pay_to", value: { stringValue: "SolOtlpDest1" } },
                    { key: "x402.tx_hash", value: { stringValue: "sim_otlp_ghost_99" } },
                    { key: "url.full", value: { stringValue: "https://otlp-merchant.test/quote" } },
                    { key: "http.response.status_code", value: { intValue: 504 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const outcome = await repo.ingestBatch(DEMO_PROJECT_ID, otlpBatch);
    expect(outcome.alertsCreated).toHaveLength(1);
    expect(outcome.alertsCreated[0]?.alertType).toBe("GHOST_PAYMENT");
  });
});
