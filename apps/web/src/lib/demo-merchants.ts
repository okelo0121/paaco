import {
  BASE_SEPOLIA_CAIP2,
  BASE_SEPOLIA_USDC_ADDRESS,
  SOLANA_DEVNET_CAIP2,
  SOLANA_DEVNET_USDC_MINT,
  normalizeNetwork,
} from "@paaco/shared";
import { randomBytes } from "node:crypto";

export type DemoScenario =
  | "clean-quote"
  | "ghost-timeout"
  | "flaky-loop"
  | "empty-payload";

interface ScenarioConfig {
  amountMicroUsd: string;
  solanaPayTo: string;
  evmPayTo: string;
  description: string;
}

const SCENARIO_CONFIGS: Record<DemoScenario, ScenarioConfig> = {
  "clean-quote": {
    amountMicroUsd: "50000",
    solanaPayTo: "MarketPyth111111111111111111111111111111111",
    evmPayTo: "0x1111222233334444555566667777888899990000",
    description: "Real-time SOL/USDC & ETH/USDC pool spread quote",
  },
  "ghost-timeout": {
    amountMicroUsd: "200000",
    solanaPayTo: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    evmPayTo: "0x9999888877776666555544443333222211110000",
    description: "Deep orderbook snapshot (simulates upstream 504 after settlement)",
  },
  "flaky-loop": {
    amountMicroUsd: "100000",
    solanaPayTo: "LoopAstSol11111111111111111111111111111111",
    evmPayTo: "0x4F2A91b2C00000000000000000000000000099A1",
    description: "Contract AST decompiler endpoint (simulates indexing retry burn)",
  },
  "empty-payload": {
    amountMicroUsd: "350000",
    solanaPayTo: "6rB9vSolPayDest222222222222222222222222222",
    evmPayTo: "0x7777666655554444333322221111000099998888",
    description: "Institutional stablecoin flow dataset (simulates HTML 502 inside 200 OK)",
  },
};

export function isDemoScenario(val: string): val is DemoScenario {
  return val in SCENARIO_CONFIGS;
}

export async function handleDemoMerchantRequest(
  scenario: DemoScenario,
  request: Request,
  preferredNetwork?: string,
): Promise<Response> {
  const cfg = SCENARIO_CONFIGS[scenario];
  const url = new URL(request.url);
  const netParam = normalizeNetwork(
    url.searchParams.get("network") ?? preferredNetwork ?? SOLANA_DEVNET_CAIP2,
  );
  const isBase = netParam === BASE_SEPOLIA_CAIP2;
  const network = isBase ? BASE_SEPOLIA_CAIP2 : SOLANA_DEVNET_CAIP2;
  const asset = isBase ? BASE_SEPOLIA_USDC_ADDRESS : SOLANA_DEVNET_USDC_MINT;
  const payTo = isBase ? cfg.evmPayTo : cfg.solanaPayTo;

  const paymentSig =
    request.headers.get("payment-signature") ?? request.headers.get("x-payment");

  if (!paymentSig) {
    const challengePayload = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network,
          amount: cfg.amountMicroUsd,
          asset,
          payTo,
          description: cfg.description,
          facilitator: isBase
            ? "https://x402.org/facilitator"
            : "https://facilitator.payai.network",
        },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(challengePayload), "utf8").toString("base64");
    return new Response(JSON.stringify(challengePayload), {
      status: 402,
      headers: {
        "content-type": "application/json",
        "payment-required": encoded,
      },
    });
  }

  const attemptNum = Number(request.headers.get("x-attempt") ?? "1");
  const randHex = randomBytes(6).toString("hex");
  const txHash = isBase
    ? `sim_0x${randHex}baseSepoliaDemo`
    : `sim_${randHex}SolanaDevnetDemo`;

  const receiptHeader = Buffer.from(
    JSON.stringify({
      txHash,
      network,
      amount: cfg.amountMicroUsd,
      asset,
      payTo,
      success: true,
    }),
    "utf8",
  ).toString("base64");

  if (scenario === "ghost-timeout" && attemptNum === 1) {
    return new Response(
      JSON.stringify({ error: "504 upstream gateway timeout" }),
      {
        status: 504,
        headers: {
          "content-type": "application/json",
          "payment-response": receiptHeader,
        },
      },
    );
  }

  if (scenario === "empty-payload") {
    return new Response(
      "<!DOCTYPE html><html><title>502 Bad Gateway</title><body>Origin feed offline</body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html",
          "payment-response": receiptHeader,
        },
      },
    );
  }

  if (scenario === "flaky-loop") {
    return new Response(
      JSON.stringify({
        status: "indexing",
        retryAfterMs: 120,
        partialBlocks: 0,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "payment-response": receiptHeader,
        },
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scenario,
      network,
      quote: { pair: isBase ? "ETH/USDC" : "SOL/USDC", midPrice: isBase ? 3142.8 : 184.51, spreadBps: 2.9 },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "payment-response": receiptHeader,
      },
    },
  );
}
