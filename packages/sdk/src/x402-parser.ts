import {
  BASE_SEPOLIA_CAIP2,
  SOLANA_DEVNET_CAIP2,
  normalizeNetwork,
  sanitizeUntrustedText,
  type PaymentRail,
} from "@paaco/shared";
import { createHash } from "node:crypto";

export interface ParsedX402Challenge {
  rail: PaymentRail;
  network: string;
  asset: string;
  amountMicroUsd: number;
  payTo: string;
  facilitatorUrl?: string;
  challengeHeaderHash: string;
  challengePreview: string;
}

export interface ParsedX402Receipt {
  txHash?: string;
  network?: string;
  payTo?: string;
  asset?: string;
  amountMicroUsd?: number;
  success?: boolean;
}

function tryDecodeJsonOrBase64(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function inferRail(network: string): PaymentRail {
  if (network.startsWith("solana:")) return "x402_solana";
  if (network.startsWith("eip155:")) return "x402_evm";
  return "api_credit";
}

function parseAtomicAmount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  if (typeof raw === "string") {
    const cleaned = raw.trim();
    if (/^\d+$/.test(cleaned)) {
      return Math.max(0, Number(cleaned));
    }
    const asFloat = Number(cleaned);
    if (Number.isFinite(asFloat)) {
      return Math.max(0, Math.round(asFloat * 1_000_000));
    }
  }
  return 0;
}

function pickRequirement(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(obj.accepts) && obj.accepts.length > 0) {
    const first = obj.accepts[0];
    if (typeof first === "object" && first !== null) {
      return first as Record<string, unknown>;
    }
  }
  if (obj.payTo || obj.maxAmountRequired || obj.amount) {
    return obj;
  }
  return null;
}

export function parseX402ChallengeFromResponse(
  headerValue: string | null,
  bodyText: string | null,
): ParsedX402Challenge | null {
  const rawSource = headerValue ?? bodyText;
  if (!rawSource) return null;

  const decoded = tryDecodeJsonOrBase64(rawSource);
  if (!decoded) return null;

  const req = pickRequirement(decoded);
  if (!req) return null;

  const rawNet = String(req.network ?? SOLANA_DEVNET_CAIP2);
  const network = normalizeNetwork(rawNet) ?? BASE_SEPOLIA_CAIP2;
  const amountMicroUsd = parseAtomicAmount(req.amount ?? req.maxAmountRequired);
  const payTo = sanitizeUntrustedText(String(req.payTo ?? "unknown"), 256);
  const asset = sanitizeUntrustedText(String(req.asset ?? "USDC"), 128);
  const facilitatorUrl =
    typeof req.facilitator === "string"
      ? sanitizeUntrustedText(req.facilitator, 512)
      : undefined;

  const challengeHeaderHash = createHash("sha256")
    .update(rawSource)
    .digest("hex")
    .slice(0, 24);

  return {
    rail: inferRail(network),
    network,
    asset,
    amountMicroUsd,
    payTo,
    facilitatorUrl,
    challengeHeaderHash,
    challengePreview: sanitizeUntrustedText(JSON.stringify(req), 900),
  };
}

export function parseX402ReceiptHeader(headerValue: string | null): ParsedX402Receipt | null {
  if (!headerValue) return null;
  const decoded = tryDecodeJsonOrBase64(headerValue);
  if (!decoded) return null;

  const txHash =
    typeof decoded.transaction === "string"
      ? decoded.transaction
      : typeof decoded.txHash === "string"
        ? decoded.txHash
        : typeof decoded.signature === "string"
          ? decoded.signature
          : undefined;

  const network =
    typeof decoded.network === "string" ? normalizeNetwork(decoded.network) : undefined;
  const payTo = typeof decoded.payTo === "string" ? decoded.payTo : undefined;
  const asset = typeof decoded.asset === "string" ? decoded.asset : undefined;
  const amountMicroUsd =
    decoded.amount !== undefined || decoded.maxAmountRequired !== undefined
      ? parseAtomicAmount(decoded.amount ?? decoded.maxAmountRequired)
      : undefined;
  const success = typeof decoded.success === "boolean" ? decoded.success : undefined;

  return {
    txHash: txHash ? sanitizeUntrustedText(txHash, 256) : undefined,
    network,
    payTo: payTo ? sanitizeUntrustedText(payTo, 256) : undefined,
    asset: asset ? sanitizeUntrustedText(asset, 128) : undefined,
    amountMicroUsd,
    success,
  };
}
