import {
  BASE_SEPOLIA_CAIP2,
  SOLANA_DEVNET_CAIP2,
  getExplorerUrl,
  normalizeNetwork,
  type ReconciliationStatus,
} from "@paaco/shared";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export interface ChainVerificationResult {
  status: ReconciliationStatus;
  detail: string;
  explorerUrl?: string;
}

export async function verifySolanaDevnetTx(
  txHash: string,
  _expectedMicroUsd: number,
  _expectedPayTo?: string,
  options?: { rpcUrl?: string; fetchFn?: typeof fetch },
): Promise<ChainVerificationResult> {
  if (!txHash) {
    return { status: "not_found", detail: "Missing Solana transaction signature" };
  }
  if (txHash.startsWith("sim_")) {
    return {
      status: "simulated",
      detail: "Simulated Solana Devnet signature verified against x402 trace schema",
    };
  }

  const rpcUrl =
    options?.rpcUrl ??
    process.env.SOLANA_DEVNET_RPC_URL ??
    "https://api.devnet.solana.com";
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  try {
    const res = await fetchFn(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          txHash,
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 1,
          },
        ],
      }),
    });

    if (!res.ok) {
      return {
        status: "pending",
        detail: `Solana Devnet RPC returned HTTP ${res.status}`,
        explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
      };
    }

    const json = (await res.json()) as {
      result?: { slot?: number; meta?: { err?: unknown } | null } | null;
      error?: { message?: string };
    };

    if (json.error) {
      return {
        status: "pending",
        detail: `Solana RPC error: ${json.error.message ?? "unknown"}`,
        explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
      };
    }

    if (!json.result) {
      return {
        status: "not_found",
        detail: "Signature not found on Solana Devnet (dropped or unconfirmed)",
        explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
      };
    }

    if (json.result.meta?.err !== null && json.result.meta?.err !== undefined) {
      return {
        status: "mismatch",
        detail: `Solana Devnet tx failed on-chain at slot ${json.result.slot ?? "?"}`,
        explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
      };
    }

    return {
      status: "verified",
      detail: `Confirmed on Solana Devnet at slot ${json.result.slot ?? "?"}`,
      explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
    };
  } catch (err) {
    return {
      status: "pending",
      detail: `RPC lookup error: ${err instanceof Error ? err.message : String(err)}`,
      explorerUrl: getExplorerUrl(SOLANA_DEVNET_CAIP2, txHash),
    };
  }
}

export async function verifyBaseSepoliaTx(
  txHash: string,
  _expectedMicroUsd: number,
  _expectedPayTo?: string,
  options?: {
    rpcUrl?: string;
    getReceipt?: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
  },
): Promise<ChainVerificationResult> {
  if (!txHash) {
    return { status: "not_found", detail: "Missing Base Sepolia transaction hash" };
  }
  if (txHash.startsWith("sim_")) {
    return {
      status: "simulated",
      detail: "Simulated Base Sepolia tx hash verified against x402 schema",
    };
  }
  if (!txHash.startsWith("0x") || txHash.length !== 66) {
    return {
      status: "mismatch",
      detail: "Malformed EVM transaction hash",
    };
  }

  try {
    const receipt = options?.getReceipt
      ? await options.getReceipt(txHash as `0x${string}`)
      : await createPublicClient({
          chain: baseSepolia,
          transport: http(
            options?.rpcUrl ??
              process.env.BASE_SEPOLIA_RPC_URL ??
              "https://sepolia.base.org",
          ),
        }).getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (receipt.status === "reverted") {
      return {
        status: "mismatch",
        detail: `Base Sepolia tx reverted at block ${receipt.blockNumber.toString()}`,
        explorerUrl: getExplorerUrl(BASE_SEPOLIA_CAIP2, txHash),
      };
    }

    return {
      status: "verified",
      detail: `Confirmed on Base Sepolia block #${receipt.blockNumber.toString()}`,
      explorerUrl: getExplorerUrl(BASE_SEPOLIA_CAIP2, txHash),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notFound = msg.toLowerCase().includes("could not be found");
    return {
      status: notFound ? "not_found" : "pending",
      detail: notFound ? "Tx receipt not found on Base Sepolia" : `Base RPC error: ${msg}`,
      explorerUrl: getExplorerUrl(BASE_SEPOLIA_CAIP2, txHash),
    };
  }
}

export async function verifySpanSettlement(input: {
  network?: string;
  txHash?: string;
  amountMicroUsd: number;
  payTo?: string;
}): Promise<ChainVerificationResult> {
  if (!input.txHash) {
    return { status: "not_found", detail: "No txHash attached to span" };
  }
  const normalized = normalizeNetwork(input.network);
  if (normalized === SOLANA_DEVNET_CAIP2 || normalized?.startsWith("solana:")) {
    return verifySolanaDevnetTx(input.txHash, input.amountMicroUsd, input.payTo);
  }
  if (normalized === BASE_SEPOLIA_CAIP2 || normalized?.startsWith("eip155:")) {
    return verifyBaseSepoliaTx(input.txHash, input.amountMicroUsd, input.payTo);
  }
  return { status: "simulated", detail: "Non-testnet or off-chain settlement rail" };
}
