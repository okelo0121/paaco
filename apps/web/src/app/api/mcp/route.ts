import { ForensicAlertTypeSchema } from "@paaco/shared";
import { createMcpHandler } from "mcp-handler";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { getRepository } from "../../../db/repository";
import { DEMO_PROJECT_ID } from "../../../db/seed-data";
import {
  handleGetAgentUnitEconomics,
  handleInspectTraceFlamegraph,
  handleListGhostPayments,
  handleSearchPaymentTraces,
} from "../../../lib/mcp/tools";

const mcpProjectContext = new AsyncLocalStorage<{ projectId: string }>();

function getProjectId(): string {
  return mcpProjectContext.getStore()?.projectId ?? DEMO_PROJECT_ID;
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    "search_payment_traces",
    {
      title: "Search Paaco Agent Payment Traces",
      description:
        "Search traced AI agent runs by natural language query or structured filters (agentId, network, alertType, anomalies).",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Natural language search, e.g. 'ghost payments on Solana'"),
        agentId: z.string().optional(),
        network: z.string().optional(),
        alertType: ForensicAlertTypeSchema.optional(),
        onlyAnomalies: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (args) => {
      const repo = getRepository();
      const result = await handleSearchPaymentTraces(repo, getProjectId(), args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "inspect_trace_flamegraph",
    {
      title: "Inspect Economic Trace Flamegraph",
      description:
        "Inspect the hierarchical LLM -> MCP -> x402 payment flamegraph, wasted spend, txHash, and Explorer links for a traceId.",
      inputSchema: z.object({
        traceId: z.string().min(1),
      }),
    },
    async (args) => {
      const repo = getRepository();
      const result = await handleInspectTraceFlamegraph(repo, getProjectId(), args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_ghost_payments",
    {
      title: "List Ghost Payments & Forensic Spend Incidents",
      description:
        "List settled-but-failed Ghost Payments (and optionally Loop Burn / Garbage Delivery incidents) with Explorer URLs.",
      inputSchema: z.object({
        includeAllAnomalies: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (args) => {
      const repo = getRepository();
      const result = await handleListGhostPayments(repo, getProjectId(), args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_agent_unit_economics",
    {
      title: "Get Agent Unit Economics & Merchant Reliability",
      description:
        "Summarize total spend (LLM tokens vs paid x402 tools vs wasted $) by agent and rank merchants by reliability.",
      inputSchema: z.object({}),
    },
    async () => {
      const repo = getRepository();
      const result = await handleGetAgentUnitEconomics(repo, getProjectId());
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
});

async function runWithProjectContext(request: Request) {
  const authHeader = request.headers.get("authorization");
  const keyHeader = request.headers.get("x-paaco-key");
  const bearer = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const repo = getRepository();
  const projectId = await repo.resolveProjectIdForApiKey(bearer ?? keyHeader);
  return mcpProjectContext.run({ projectId }, () => handler(request));
}

export { runWithProjectContext as GET, runWithProjectContext as POST };
