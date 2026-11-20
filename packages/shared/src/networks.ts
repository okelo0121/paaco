export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const BASE_SEPOLIA_CAIP2 = "eip155:84532";
export const BASE_MAINNET_CAIP2 = "eip155:8453";

export const SOLANA_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface NetworkInfo {
  caip2: string;
  label: string;
  shortLabel: string;
  family: "solana" | "evm";
  isTestnet: boolean;
  defaultAsset: string;
  explorerTxTemplate: string;
}

export const NETWORK_REGISTRY: Record<string, NetworkInfo> = {
  [SOLANA_DEVNET_CAIP2]: {
    caip2: SOLANA_DEVNET_CAIP2,
    label: "Solana Devnet",
    shortLabel: "Solana Devnet",
    family: "solana",
    isTestnet: true,
    defaultAsset: SOLANA_DEVNET_USDC_MINT,
    explorerTxTemplate: "https://explorer.solana.com/tx/{hash}?cluster=devnet",
  },
  [SOLANA_MAINNET_CAIP2]: {
    caip2: SOLANA_MAINNET_CAIP2,
    label: "Solana Mainnet",
    shortLabel: "Solana",
    family: "solana",
    isTestnet: false,
    defaultAsset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    explorerTxTemplate: "https://explorer.solana.com/tx/{hash}",
  },
  [BASE_SEPOLIA_CAIP2]: {
    caip2: BASE_SEPOLIA_CAIP2,
    label: "Base Sepolia",
    shortLabel: "Base Sepolia",
    family: "evm",
    isTestnet: true,
    defaultAsset: BASE_SEPOLIA_USDC_ADDRESS,
    explorerTxTemplate: "https://sepolia.basescan.org/tx/{hash}",
  },
  [BASE_MAINNET_CAIP2]: {
    caip2: BASE_MAINNET_CAIP2,
    label: "Base Mainnet",
    shortLabel: "Base",
    family: "evm",
    isTestnet: false,
    defaultAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorerTxTemplate: "https://basescan.org/tx/{hash}",
  },
};

export function normalizeNetwork(network?: string | null): string | undefined {
  if (!network) return undefined;
  const trimmed = network.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "solana:devnet" || lower === "solana-devnet") return SOLANA_DEVNET_CAIP2;
  if (lower === "solana:mainnet" || lower === "solana-mainnet") return SOLANA_MAINNET_CAIP2;
  if (lower === "base-sepolia" || lower === "base_sepolia") return BASE_SEPOLIA_CAIP2;
  if (lower === "base" || lower === "base-mainnet") return BASE_MAINNET_CAIP2;
  return trimmed;
}

export function getNetworkInfo(network?: string | null): NetworkInfo | undefined {
  const normalized = normalizeNetwork(network);
  if (!normalized) return undefined;
  return NETWORK_REGISTRY[normalized];
}

export function getExplorerUrl(network?: string | null, txHash?: string | null): string | undefined {
  if (!txHash || txHash.startsWith("sim_")) return undefined;
  const info = getNetworkInfo(network);
  if (!info) return undefined;
  return info.explorerTxTemplate.replace("{hash}", encodeURIComponent(txHash));
}

export function formatMicroUsd(microUsd: number | bigint): string {
  const num = typeof microUsd === "bigint" ? Number(microUsd) : microUsd;
  if (!Number.isFinite(num)) return "$0.00";
  const dollars = num / 1_000_000;
  const abs = Math.abs(dollars);
  if (abs === 0) return "$0.00";
  if (abs < 0.01) return `$${dollars.toFixed(4)}`;
  if (abs < 10) return `$${dollars.toFixed(3).replace(/0$/, "")}`;
  return `$${dollars.toFixed(2)}`;
}
