import { z } from "zod";

export function sanitizeUntrustedText(input: string, maxLen = 500): string {
  let out = "";
  for (let i = 0; i < input.length && out.length < maxLen; i++) {
    const code = input.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      out += input[i];
    }
  }
  return out.trim();
}

export const PaymentRailSchema = z.enum([
  "x402_solana",
  "x402_evm",
  "stripe",
  "llm_tokens",
  "api_credit",
]);
export type PaymentRail = z.infer<typeof PaymentRailSchema>;

export const SpanKindSchema = z.enum([
  "llm",
  "mcp_tool",
  "http_payment",
  "subagent",
  "custom",
]);
export type SpanKind = z.infer<typeof SpanKindSchema>;

export const SpanStatusSchema = z.enum(["ok", "error", "timeout"]);
export type SpanStatus = z.infer<typeof SpanStatusSchema>;

export const SettlementStatusSchema = z.enum([
  "quoted",
  "submitted",
  "settled",
  "failed",
  "ghost_payment",
]);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const ReconciliationStatusSchema = z.enum([
  "pending",
  "verified",
  "mismatch",
  "not_found",
  "simulated",
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

export const ForensicAlertTypeSchema = z.enum([
  "GHOST_PAYMENT",
  "LOOP_BURN",
  "GARBAGE_DELIVERY",
  "RECON_MISMATCH",
]);
export type ForensicAlertType = z.infer<typeof ForensicAlertTypeSchema>;

export const AlertSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const TriageStatusSchema = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "MERCHANT_FLAGGED",
  "RESOLVED",
]);
export type TriageStatus = z.infer<typeof TriageStatusSchema>;

export const LlmSpanPayloadSchema = z.object({
  model: z.string().max(128),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().default(0),
  costMicroUsd: z.number().int().nonnegative(),
});

export const McpSpanPayloadSchema = z.object({
  serverName: z.string().max(128),
  toolName: z.string().max(128),
  argsPreview: z.string().max(500).optional(),
  responseBytes: z.number().int().nonnegative().default(0),
  isEmptyOrError: z.boolean().default(false),
});

export const HttpPaymentPayloadSchema = z.object({
  rail: PaymentRailSchema,
  network: z.string().max(128),
  asset: z.string().max(128).default("USDC"),
  amountMicroUsd: z.number().int().nonnegative(),
  payTo: z.string().max(256),
  merchantUrl: z.string().max(2048),
  merchantDomain: z.string().max(256),
  httpStatus: z.number().int().min(0).max(599).optional(),
  challengeHeaderHash: z.string().max(128).optional(),
  challengePreview: z.string().max(1000).optional(),
  txHash: z.string().max(256).optional(),
  facilitatorUrl: z.string().max(512).optional(),
  settlementStatus: SettlementStatusSchema,
  responseBytes: z.number().int().nonnegative().optional(),
  responsePreview: z.string().max(600).optional(),
});

export const SpanInputSchema = z.object({
  spanId: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  parentSpanId: z.string().max(128).optional(),
  kind: SpanKindSchema,
  name: z.string().min(1).max(256),
  startedAt: z.string(),
  endedAt: z.string(),
  status: SpanStatusSchema.default("ok"),
  llm: LlmSpanPayloadSchema.optional(),
  mcp: McpSpanPayloadSchema.optional(),
  payment: HttpPaymentPayloadSchema.optional(),
  errorMessage: z.string().max(500).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type SpanInput = z.infer<typeof SpanInputSchema>;

export const TraceInputSchema = z.object({
  traceId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(128),
  userId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  userPrompt: z.string().min(1).max(2000),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: SpanStatusSchema.default("ok"),
  isDemo: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TraceInput = z.infer<typeof TraceInputSchema>;

export const IngestBatchRequestSchema = z.object({
  traces: z.array(TraceInputSchema).max(50).default([]),
  spans: z.array(SpanInputSchema).min(1).max(500),
});
export type IngestBatchRequest = z.infer<typeof IngestBatchRequestSchema>;

export const TraceFilterSchema = z.object({
  agentId: z.string().max(128).optional(),
  userId: z.string().max(128).optional(),
  network: z.string().max(128).optional(),
  alertType: ForensicAlertTypeSchema.optional(),
  onlyAnomalies: z.boolean().optional(),
  minWastedMicroUsd: z.number().int().nonnegative().optional(),
  minTotalMicroUsd: z.number().int().nonnegative().optional(),
  merchantDomain: z.string().max(256).optional(),
  searchText: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type TraceFilter = z.infer<typeof TraceFilterSchema>;

export const TriageRequestSchema = z.object({
  status: TriageStatusSchema,
  note: z.string().max(500).optional(),
});
export type TriageRequest = z.infer<typeof TriageRequestSchema>;

export interface EconomicSummary {
  totalMicroUsd: number;
  llmTokenMicroUsd: number;
  toolPaymentMicroUsd: number;
  wastedMicroUsd: number;
  settledCount: number;
  ghostCount: number;
  loopCount: number;
  garbageCount: number;
}

export interface DetectedAlert {
  spanId: string;
  alertType: ForensicAlertType;
  severity: AlertSeverity;
  wastedMicroUsd: number;
  summary: string;
}
