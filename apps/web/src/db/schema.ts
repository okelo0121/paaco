import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("api_keys_hash_idx").on(table.keyHash)],
);

export const traces = pgTable(
  "traces",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    externalTraceId: text("external_trace_id").notNull(),
    agentId: text("agent_id").notNull(),
    userId: text("user_id"),
    sessionId: text("session_id"),
    userPrompt: text("user_prompt").notNull(),
    status: text("status").notNull().default("ok"),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    totalMicroUsd: bigint("total_micro_usd", { mode: "number" }).notNull().default(0),
    llmTokenMicroUsd: bigint("llm_token_micro_usd", { mode: "number" }).notNull().default(0),
    toolPaymentMicroUsd: bigint("tool_payment_micro_usd", { mode: "number" }).notNull().default(0),
    wastedMicroUsd: bigint("wasted_micro_usd", { mode: "number" }).notNull().default(0),
    hasAnomalies: boolean("has_anomalies").notNull().default(false),
    anomalyCount: integer("anomaly_count").notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("traces_proj_started_idx").on(table.projectId, table.startedAt),
    index("traces_proj_agent_idx").on(table.projectId, table.agentId),
    index("traces_proj_anom_idx").on(table.projectId, table.hasAnomalies),
    uniqueIndex("traces_proj_ext_idx").on(table.projectId, table.externalTraceId),
  ],
);

export const spans = pgTable(
  "spans",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    externalSpanId: text("external_span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ok"),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    wastedMicroUsd: bigint("wasted_micro_usd", { mode: "number" }).notNull().default(0),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    mcpServer: text("mcp_server"),
    mcpTool: text("mcp_tool"),
    argsPreview: text("args_preview"),
    rail: text("rail"),
    network: text("network"),
    asset: text("asset"),
    payTo: text("pay_to"),
    merchantDomain: text("merchant_domain"),
    merchantUrl: text("merchant_url"),
    httpStatus: integer("http_status"),
    challengeHeaderHash: text("challenge_header_hash"),
    challengePreview: text("challenge_preview"),
    txHash: text("tx_hash"),
    explorerUrl: text("explorer_url"),
    facilitatorUrl: text("facilitator_url"),
    settlementStatus: text("settlement_status"),
    reconciliationStatus: text("reconciliation_status"),
    reconciliationDetail: text("reconciliation_detail"),
    responseBytes: integer("response_bytes"),
    responsePreview: text("response_preview"),
    errorMessage: text("error_message"),
    attributesJson: jsonb("attributes_json"),
  },
  (table) => [
    index("spans_trace_idx").on(table.traceId),
    index("spans_network_idx").on(table.network),
    index("spans_domain_idx").on(table.merchantDomain),
  ],
);

export const forensicAlerts = pgTable(
  "forensic_alerts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    spanId: text("span_id").notNull(),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull(),
    wastedMicroUsd: bigint("wasted_micro_usd", { mode: "number" }).notNull().default(0),
    summary: text("summary").notNull(),
    workflowRunId: text("workflow_run_id"),
    workflowHookToken: text("workflow_hook_token"),
    triageStatus: text("triage_status").notNull().default("OPEN"),
    triageNote: text("triage_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("alerts_proj_status_idx").on(table.projectId, table.triageStatus),
    index("alerts_trace_idx").on(table.traceId),
  ],
);
