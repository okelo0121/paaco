import {
  BASE_SEPOLIA_CAIP2,
  SOLANA_DEVNET_CAIP2,
  TraceFilterSchema,
  formatMicroUsd,
  type TraceFilter,
} from "@paaco/shared";
import { Output, generateText } from "ai";
import { z } from "zod";
import type { StoredTrace, TraceRepository } from "../../db/repository";

const LogFinderPlanSchema = z.object({
  filter: TraceFilterSchema,
  explanation: z.string().max(280),
});

export interface LogSearchResult {
  query: string;
  mode: "ai_gateway" | "deterministic";
  appliedFilter: TraceFilter;
  summary: string;
  totalMatched: number;
  totalWastedMicroUsd: number;
  traces: StoredTrace[];
}

export function parseQueryDeterministic(query: string): {
  filter: TraceFilter;
  explanation: string;
} {
  const q = query.toLowerCase();
  const filter: TraceFilter = { limit: 25 };

  if (q.includes("ghost") || q.includes("timeout") || q.includes("504") || q.includes("double")) {
    filter.alertType = "GHOST_PAYMENT";
    filter.onlyAnomalies = true;
  } else if (q.includes("loop") || q.includes("retry") || q.includes("burst")) {
    filter.alertType = "LOOP_BURN";
    filter.onlyAnomalies = true;
  } else if (q.includes("garbage") || q.includes("empty") || q.includes("html") || q.includes("502")) {
    filter.alertType = "GARBAGE_DELIVERY";
    filter.onlyAnomalies = true;
  } else if (q.includes("wasted") || q.includes("waste") || q.includes("anomal") || q.includes("burn")) {
    filter.onlyAnomalies = true;
  }

  if (q.includes("solana") || /\bsol\b/.test(q)) {
    filter.network = SOLANA_DEVNET_CAIP2;
  } else if (q.includes("base") || q.includes("sepolia") || q.includes("evm")) {
    filter.network = BASE_SEPOLIA_CAIP2;
  }

  const dollarMatch = q.match(/(?:over|above|>=?|>|more than)\s*\$?(\d+(?:\.\d+)?)/i);
  if (dollarMatch?.[1]) {
    const micro = Math.round(Number(dollarMatch[1]) * 1_000_000);
    if (Number.isFinite(micro) && micro > 0) {
      if (filter.onlyAnomalies || q.includes("waste")) {
        filter.minWastedMicroUsd = micro;
      } else {
        filter.minTotalMicroUsd = micro;
      }
    }
  }

  const agentMatch = q.match(/\b([a-z0-9-]+-agent)\b/i);
  if (agentMatch?.[1]) {
    filter.agentId = agentMatch[1];
  }

  const domainMatch = q.match(/\b([a-z0-9-]+\.[a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (domainMatch?.[1]) {
    filter.merchantDomain = domainMatch[1];
  }

  if (
    !filter.alertType &&
    !filter.onlyAnomalies &&
    !filter.network &&
    !filter.agentId &&
    !filter.merchantDomain &&
    filter.minTotalMicroUsd === undefined &&
    query.trim().length > 0
  ) {
    filter.searchText = query.trim();
  }

  const parts: string[] = [];
  if (filter.alertType) parts.push(`alert=${filter.alertType}`);
  else if (filter.onlyAnomalies) parts.push("anomalies=true");
  if (filter.network) parts.push(`network=${filter.network}`);
  if (filter.agentId) parts.push(`agent=${filter.agentId}`);
  if (filter.merchantDomain) parts.push(`merchant=${filter.merchantDomain}`);
  if (filter.minWastedMicroUsd) parts.push(`wasted>=${formatMicroUsd(filter.minWastedMicroUsd)}`);
  if (filter.minTotalMicroUsd) parts.push(`total>=${formatMicroUsd(filter.minTotalMicroUsd)}`);
  if (filter.searchText) parts.push(`text="${filter.searchText}"`);

  return {
    filter,
    explanation:
      parts.length > 0
        ? `Filtered traces by ${parts.join(", ")}.`
        : "Showing most recent traced agent runs.",
  };
}

export async function runNaturalLanguageLogSearch(
  repo: TraceRepository,
  projectId: string,
  query: string,
): Promise<LogSearchResult> {
  const trimmed = query.trim();
  let mode: "ai_gateway" | "deterministic" = "deterministic";
  let plan = parseQueryDeterministic(trimmed);

  if (trimmed.length > 0 && process.env.AI_GATEWAY_API_KEY?.trim()) {
    try {
      const result = await generateText({
        model: process.env.PAACO_MODEL ?? "anthropic/claude-haiku-4.5",
        output: Output.object({ schema: LogFinderPlanSchema }),
        prompt: [
          "Translate the developer's agent-payment debugging query into a safe structured TraceFilter.",
          `Available networks: "${SOLANA_DEVNET_CAIP2}" (Solana Devnet), "${BASE_SEPOLIA_CAIP2}" (Base Sepolia).`,
          `Alert types: "GHOST_PAYMENT" (settled tx but HTTP 5xx/timeout), "LOOP_BURN" (repeated paid retries), "GARBAGE_DELIVERY" (settled HTTP 200 with empty/HTML error payload), "RECON_MISMATCH".`,
          "Convert dollar amounts into integer micro-USD ($1.00 = 1000000). Never invent values not implied by the query.",
          `Developer query: ${JSON.stringify(trimmed)}`,
        ].join("\n"),
      });
      if (result.output?.filter) {
        mode = "ai_gateway";
        plan = result.output;
      }
    } catch {
      // Fall back seamlessly to deterministic NLP parser if AI Gateway is unavailable
      mode = "deterministic";
    }
  }

  const traces = await repo.listTraces(projectId, plan.filter);
  const totalWastedMicroUsd = traces.reduce((acc, t) => acc + t.wastedMicroUsd, 0);

  const summary =
    traces.length === 0
      ? `${plan.explanation} No matching traces found.`
      : `${plan.explanation} Found ${traces.length} trace(s) totaling ${formatMicroUsd(totalWastedMicroUsd)} in wasted spend.`;

  return {
    query: trimmed,
    mode,
    appliedFilter: plan.filter,
    summary,
    totalMatched: traces.length,
    totalWastedMicroUsd,
    traces,
  };
}
