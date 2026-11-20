import {
  analyzeTraceForensics,
  getExplorerUrl,
  normalizeNetwork,
  type AlertSeverity,
  type ForensicAlertType,
  type IngestBatchRequest,
  type ReconciliationStatus,
  type TraceFilter,
  type TriageStatus,
} from "@paaco/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./index";
import { apiKeys, forensicAlerts, projects, spans, traces } from "./schema";
import { DEMO_API_KEY, DEMO_PROJECT_ID, SEED_BATCHES } from "./seed-data";

export interface StoredTrace {
  id: string;
  projectId: string;
  externalTraceId: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  userPrompt: string;
  status: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  totalMicroUsd: number;
  llmTokenMicroUsd: number;
  toolPaymentMicroUsd: number;
  wastedMicroUsd: number;
  hasAnomalies: boolean;
  anomalyCount: number;
  isDemo: boolean;
  createdAt: string;
}

export interface StoredSpan {
  id: string;
  traceId: string;
  externalSpanId: string;
  parentSpanId?: string;
  kind: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  costMicroUsd: number;
  wastedMicroUsd: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  mcpServer?: string;
  mcpTool?: string;
  argsPreview?: string;
  rail?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  merchantDomain?: string;
  merchantUrl?: string;
  httpStatus?: number;
  challengeHeaderHash?: string;
  challengePreview?: string;
  txHash?: string;
  explorerUrl?: string;
  facilitatorUrl?: string;
  settlementStatus?: string;
  reconciliationStatus?: ReconciliationStatus;
  reconciliationDetail?: string;
  responseBytes?: number;
  responsePreview?: string;
  errorMessage?: string;
  attributesJson?: Record<string, unknown>;
}

export interface StoredAlert {
  id: string;
  projectId: string;
  traceId: string;
  spanId: string;
  alertType: ForensicAlertType;
  severity: AlertSeverity;
  wastedMicroUsd: number;
  summary: string;
  workflowRunId?: string;
  workflowHookToken?: string;
  triageStatus: TriageStatus;
  triageNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TraceDetail {
  trace: StoredTrace;
  spans: StoredSpan[];
  alerts: StoredAlert[];
}

export interface StoredApiKey {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface AgentUnitEconomics {
  agentId: string;
  traceCount: number;
  anomalyTraceCount: number;
  totalMicroUsd: number;
  llmTokenMicroUsd: number;
  toolPaymentMicroUsd: number;
  wastedMicroUsd: number;
  wasteRatePct: number;
}

export interface MerchantReliability {
  merchantDomain: string;
  network: string;
  paidCallCount: number;
  settledMicroUsd: number;
  ghostOrGarbageCount: number;
  wastedMicroUsd: number;
  reliabilityPct: number;
}

export interface UnitEconomicsReport {
  totals: {
    traceCount: number;
    totalMicroUsd: number;
    llmTokenMicroUsd: number;
    toolPaymentMicroUsd: number;
    wastedMicroUsd: number;
    openAlertCount: number;
  };
  byAgent: AgentUnitEconomics[];
  byMerchant: MerchantReliability[];
}

export interface IngestOutcome {
  traceIds: string[];
  alertsCreated: StoredAlert[];
}

export interface TraceRepository {
  ingestBatch(projectId: string, batch: IngestBatchRequest): Promise<IngestOutcome>;
  listTraces(projectId: string, filter?: Partial<TraceFilter>): Promise<StoredTrace[]>;
  getTraceDetail(projectId: string, traceId: string): Promise<TraceDetail | null>;
  listAlerts(projectId: string, status?: TriageStatus): Promise<StoredAlert[]>;
  getAlert(alertId: string): Promise<StoredAlert | null>;
  setAlertWorkflowInfo(
    alertId: string,
    info: { workflowRunId?: string; workflowHookToken?: string },
  ): Promise<void>;
  triageAlert(
    alertId: string,
    input: { status: TriageStatus; note?: string },
  ): Promise<StoredAlert | null>;
  updateSpanReconciliation(
    spanId: string,
    input: { status: ReconciliationStatus; detail: string; explorerUrl?: string },
  ): Promise<void>;
  getUnitEconomics(projectId: string): Promise<UnitEconomicsReport>;
  listApiKeys(projectId: string): Promise<StoredApiKey[]>;
  createApiKey(
    projectId: string,
    name: string,
  ): Promise<{ apiKey: StoredApiKey; plaintextKey: string }>;
  revokeApiKey(projectId: string, keyId: string): Promise<boolean>;
  resolveProjectIdForApiKey(rawKey: string | null): Promise<string>;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function durationBetween(startIso: string, endIso: string): number {
  const diff = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff) : 1;
}

function normalizeBatchToRecords(projectId: string, batch: IngestBatchRequest) {
  const spansByExtTrace = new Map<string, typeof batch.spans>();
  for (const sp of batch.spans) {
    const arr = spansByExtTrace.get(sp.traceId) ?? [];
    arr.push(sp);
    spansByExtTrace.set(sp.traceId, arr);
  }

  const traceMap = new Map(batch.traces.map((t) => [t.traceId, t]));
  for (const [extTraceId, spList] of spansByExtTrace) {
    if (!traceMap.has(extTraceId)) {
      const first = spList[0]!;
      const last = spList[spList.length - 1]!;
      traceMap.set(extTraceId, {
        traceId: extTraceId,
        agentId: "unknown-agent",
        userPrompt: first.name,
        startedAt: first.startedAt,
        endedAt: last.endedAt,
        status: spList.some((s) => s.status !== "ok") ? "error" : "ok",
      });
    }
  }

  const normalizedTraces: Array<{
    trace: StoredTrace;
    spans: StoredSpan[];
    alerts: StoredAlert[];
  }> = [];

  for (const [extTraceId, traceInput] of traceMap) {
    const spList = spansByExtTrace.get(extTraceId) ?? [];
    const { alerts, summary } = analyzeTraceForensics(spList);

    const wasteByExtSpan = new Map<string, number>();
    for (const alert of alerts) {
      const prev = wasteByExtSpan.get(alert.spanId) ?? 0;
      if (alert.wastedMicroUsd > prev) wasteByExtSpan.set(alert.spanId, alert.wastedMicroUsd);
    }

    const traceId = traceInput.traceId.startsWith("tr_")
      ? traceInput.traceId
      : `tr_${traceInput.traceId}`;
    const endedAt =
      traceInput.endedAt ??
      spList.reduce((max, s) => (s.endedAt > max ? s.endedAt : max), traceInput.startedAt);
    const nowIso = new Date().toISOString();

    const storedTrace: StoredTrace = {
      id: traceId,
      projectId,
      externalTraceId: extTraceId,
      agentId: traceInput.agentId,
      userId: traceInput.userId,
      sessionId: traceInput.sessionId,
      userPrompt: traceInput.userPrompt,
      status: traceInput.status ?? "ok",
      startedAt: traceInput.startedAt,
      endedAt,
      durationMs: durationBetween(traceInput.startedAt, endedAt),
      totalMicroUsd: summary.totalMicroUsd,
      llmTokenMicroUsd: summary.llmTokenMicroUsd,
      toolPaymentMicroUsd: summary.toolPaymentMicroUsd,
      wastedMicroUsd: summary.wastedMicroUsd,
      hasAnomalies: alerts.length > 0,
      anomalyCount: alerts.length,
      isDemo: Boolean(traceInput.isDemo),
      createdAt: nowIso,
    };

    // Map externalSpanId -> canonical internal span ID so parent links survive
    const idMap = new Map<string, string>();
    for (const sp of spList) {
      idMap.set(sp.spanId, `${traceId}__${sp.spanId}`);
    }

    const storedSpans: StoredSpan[] = spList.map((sp) => {
      const payment = sp.payment;
      const network = normalizeNetwork(payment?.network);
      const txHash = payment?.txHash;
      const explorerUrl = getExplorerUrl(network, txHash);
      const costMicroUsd = (sp.llm?.costMicroUsd ?? 0) + (payment?.amountMicroUsd ?? 0);
      const reconciliationStatus: ReconciliationStatus | undefined = payment
        ? txHash
          ? txHash.startsWith("sim_")
            ? "simulated"
            : "pending"
          : undefined
        : undefined;

      return {
        id: idMap.get(sp.spanId)!,
        traceId,
        externalSpanId: sp.spanId,
        parentSpanId: sp.parentSpanId ? idMap.get(sp.parentSpanId) ?? sp.parentSpanId : undefined,
        kind: sp.kind,
        name: sp.name,
        status: sp.status,
        startedAt: sp.startedAt,
        endedAt: sp.endedAt,
        durationMs: durationBetween(sp.startedAt, sp.endedAt),
        costMicroUsd,
        wastedMicroUsd: wasteByExtSpan.get(sp.spanId) ?? 0,
        model: sp.llm?.model,
        inputTokens: sp.llm?.inputTokens,
        outputTokens: sp.llm?.outputTokens,
        reasoningTokens: sp.llm?.reasoningTokens,
        mcpServer: sp.mcp?.serverName,
        mcpTool: sp.mcp?.toolName,
        argsPreview: sp.mcp?.argsPreview,
        rail: payment?.rail,
        network,
        asset: payment?.asset,
        payTo: payment?.payTo,
        merchantDomain: payment?.merchantDomain,
        merchantUrl: payment?.merchantUrl,
        httpStatus: payment?.httpStatus,
        challengeHeaderHash: payment?.challengeHeaderHash,
        challengePreview: payment?.challengePreview,
        txHash,
        explorerUrl,
        facilitatorUrl: payment?.facilitatorUrl,
        settlementStatus: payment?.settlementStatus,
        reconciliationStatus,
        reconciliationDetail:
          reconciliationStatus === "simulated"
            ? "Demo testnet trace signature (verified schema)"
            : undefined,
        responseBytes: payment?.responseBytes ?? sp.mcp?.responseBytes,
        responsePreview: payment?.responsePreview,
        errorMessage: sp.errorMessage,
        attributesJson: sp.attributes,
      };
    });

    const storedAlerts: StoredAlert[] = alerts.map((a, idx) => ({
      id: `al_${randomUUID().replace(/-/g, "").slice(0, 12)}_${idx}`,
      projectId,
      traceId,
      spanId: idMap.get(a.spanId) ?? a.spanId,
      alertType: a.alertType,
      severity: a.severity,
      wastedMicroUsd: a.wastedMicroUsd,
      summary: a.summary,
      triageStatus: "OPEN",
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    normalizedTraces.push({
      trace: storedTrace,
      spans: storedSpans,
      alerts: storedAlerts,
    });
  }

  return normalizedTraces;
}

function buildUnitEconomics(
  projectTraces: StoredTrace[],
  projectSpans: StoredSpan[],
  openAlertCount: number,
): UnitEconomicsReport {
  const agentMap = new Map<string, AgentUnitEconomics>();
  let totalMicroUsd = 0;
  let llmTokenMicroUsd = 0;
  let toolPaymentMicroUsd = 0;
  let wastedMicroUsd = 0;

  for (const t of projectTraces) {
    totalMicroUsd += t.totalMicroUsd;
    llmTokenMicroUsd += t.llmTokenMicroUsd;
    toolPaymentMicroUsd += t.toolPaymentMicroUsd;
    wastedMicroUsd += t.wastedMicroUsd;

    const existing = agentMap.get(t.agentId) ?? {
      agentId: t.agentId,
      traceCount: 0,
      anomalyTraceCount: 0,
      totalMicroUsd: 0,
      llmTokenMicroUsd: 0,
      toolPaymentMicroUsd: 0,
      wastedMicroUsd: 0,
      wasteRatePct: 0,
    };
    existing.traceCount += 1;
    if (t.hasAnomalies) existing.anomalyTraceCount += 1;
    existing.totalMicroUsd += t.totalMicroUsd;
    existing.llmTokenMicroUsd += t.llmTokenMicroUsd;
    existing.toolPaymentMicroUsd += t.toolPaymentMicroUsd;
    existing.wastedMicroUsd += t.wastedMicroUsd;
    existing.wasteRatePct =
      existing.totalMicroUsd > 0
        ? Math.round((existing.wastedMicroUsd / existing.totalMicroUsd) * 1000) / 10
        : 0;
    agentMap.set(t.agentId, existing);
  }

  const merchantMap = new Map<string, MerchantReliability>();
  for (const s of projectSpans) {
    if (s.kind !== "http_payment" || !s.merchantDomain) continue;
    const isSettled = Boolean(s.txHash) || s.settlementStatus === "settled" || s.settlementStatus === "ghost_payment";
    if (!isSettled) continue;
    const key = `${s.merchantDomain}|${s.network ?? "unknown"}`;
    const m = merchantMap.get(key) ?? {
      merchantDomain: s.merchantDomain,
      network: s.network ?? "unknown",
      paidCallCount: 0,
      settledMicroUsd: 0,
      ghostOrGarbageCount: 0,
      wastedMicroUsd: 0,
      reliabilityPct: 100,
    };
    m.paidCallCount += 1;
    m.settledMicroUsd += s.costMicroUsd;
    if (s.wastedMicroUsd > 0) {
      m.ghostOrGarbageCount += 1;
      m.wastedMicroUsd += s.wastedMicroUsd;
    }
    m.reliabilityPct =
      m.paidCallCount > 0
        ? Math.round(((m.paidCallCount - m.ghostOrGarbageCount) / m.paidCallCount) * 1000) / 10
        : 100;
    merchantMap.set(key, m);
  }

  return {
    totals: {
      traceCount: projectTraces.length,
      totalMicroUsd,
      llmTokenMicroUsd,
      toolPaymentMicroUsd,
      wastedMicroUsd,
      openAlertCount,
    },
    byAgent: Array.from(agentMap.values()).sort((a, b) => b.totalMicroUsd - a.totalMicroUsd),
    byMerchant: Array.from(merchantMap.values()).sort(
      (a, b) => a.reliabilityPct - b.reliabilityPct || b.settledMicroUsd - a.settledMicroUsd,
    ),
  };
}

export class InMemoryTraceRepository implements TraceRepository {
  private readonly traceStore = new Map<string, StoredTrace>();
  private readonly spanStore = new Map<string, StoredSpan[]>();
  private readonly alertStore = new Map<string, StoredAlert>();
  private readonly keyStore = new Map<string, { record: StoredApiKey; hash: string }>();
  private seeded = false;

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    const demoKeyHash = hashApiKey(DEMO_API_KEY);
    this.keyStore.set("key_demo_default", {
      hash: demoKeyHash,
      record: {
        id: "key_demo_default",
        projectId: DEMO_PROJECT_ID,
        name: "Demo Playground & MCP Key",
        keyPrefix: `${DEMO_API_KEY.slice(0, 12)}...`,
        createdAt: new Date().toISOString(),
      },
    });
    for (const batch of SEED_BATCHES) {
      await this.ingestBatch(DEMO_PROJECT_ID, batch);
    }
  }

  async ingestBatch(projectId: string, batch: IngestBatchRequest): Promise<IngestOutcome> {
    const normalized = normalizeBatchToRecords(projectId, batch);
    const traceIds: string[] = [];
    const alertsCreated: StoredAlert[] = [];

    for (const item of normalized) {
      this.traceStore.set(item.trace.id, item.trace);
      const existingSpans = this.spanStore.get(item.trace.id) ?? [];
      const mergedMap = new Map(existingSpans.map((s) => [s.id, s]));
      for (const sp of item.spans) mergedMap.set(sp.id, sp);
      this.spanStore.set(item.trace.id, Array.from(mergedMap.values()));

      for (const alert of item.alerts) {
        this.alertStore.set(alert.id, alert);
        alertsCreated.push(alert);
      }
      traceIds.push(item.trace.id);
    }

    return { traceIds, alertsCreated };
  }

  async listTraces(projectId: string, filter: Partial<TraceFilter> = {}): Promise<StoredTrace[]> {
    await this.ensureSeeded();
    const normalizedNet = normalizeNetwork(filter.network);
    const q = filter.searchText?.toLowerCase().trim();
    const domainFilter = filter.merchantDomain?.toLowerCase().trim();

    const matched: StoredTrace[] = [];
    for (const trace of this.traceStore.values()) {
      if (trace.projectId !== projectId) continue;
      if (filter.agentId && trace.agentId !== filter.agentId) continue;
      if (filter.userId && trace.userId !== filter.userId) continue;
      if (filter.onlyAnomalies && !trace.hasAnomalies) continue;
      if (
        filter.minWastedMicroUsd !== undefined &&
        trace.wastedMicroUsd < filter.minWastedMicroUsd
      ) {
        continue;
      }
      if (
        filter.minTotalMicroUsd !== undefined &&
        trace.totalMicroUsd < filter.minTotalMicroUsd
      ) {
        continue;
      }

      const traceSpans = this.spanStore.get(trace.id) ?? [];
      const traceAlerts = Array.from(this.alertStore.values()).filter(
        (a) => a.traceId === trace.id,
      );

      if (normalizedNet && !traceSpans.some((s) => s.network === normalizedNet)) continue;
      if (
        domainFilter &&
        !traceSpans.some((s) => s.merchantDomain?.toLowerCase().includes(domainFilter))
      ) {
        continue;
      }
      if (filter.alertType && !traceAlerts.some((a) => a.alertType === filter.alertType)) {
        continue;
      }
      if (q) {
        const hay = [
          trace.id,
          trace.agentId,
          trace.userId ?? "",
          trace.userPrompt,
          ...traceSpans.map(
            (s) => `${s.name} ${s.merchantDomain ?? ""} ${s.txHash ?? ""} ${s.mcpTool ?? ""}`,
          ),
          ...traceAlerts.map((a) => `${a.alertType} ${a.summary}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }

      matched.push(trace);
    }

    matched.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return matched.slice(0, filter.limit ?? 25);
  }

  async getTraceDetail(projectId: string, traceId: string): Promise<TraceDetail | null> {
    await this.ensureSeeded();
    const trace = this.traceStore.get(traceId);
    if (!trace || trace.projectId !== projectId) return null;
    const spList = [...(this.spanStore.get(traceId) ?? [])].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const alerts = Array.from(this.alertStore.values()).filter((a) => a.traceId === traceId);
    return { trace, spans: spList, alerts };
  }

  async listAlerts(projectId: string, status?: TriageStatus): Promise<StoredAlert[]> {
    await this.ensureSeeded();
    return Array.from(this.alertStore.values())
      .filter((a) => a.projectId === projectId && (!status || a.triageStatus === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getAlert(alertId: string): Promise<StoredAlert | null> {
    await this.ensureSeeded();
    return this.alertStore.get(alertId) ?? null;
  }

  async setAlertWorkflowInfo(
    alertId: string,
    info: { workflowRunId?: string; workflowHookToken?: string },
  ): Promise<void> {
    const existing = this.alertStore.get(alertId);
    if (!existing) return;
    existing.workflowRunId = info.workflowRunId ?? existing.workflowRunId;
    existing.workflowHookToken = info.workflowHookToken ?? existing.workflowHookToken;
    existing.updatedAt = new Date().toISOString();
  }

  async triageAlert(
    alertId: string,
    input: { status: TriageStatus; note?: string },
  ): Promise<StoredAlert | null> {
    const existing = this.alertStore.get(alertId);
    if (!existing) return null;
    existing.triageStatus = input.status;
    existing.triageNote = input.note ?? existing.triageNote;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  async updateSpanReconciliation(
    spanId: string,
    input: { status: ReconciliationStatus; detail: string; explorerUrl?: string },
  ): Promise<void> {
    for (const spList of this.spanStore.values()) {
      const target = spList.find((s) => s.id === spanId);
      if (target) {
        target.reconciliationStatus = input.status;
        target.reconciliationDetail = input.detail;
        if (input.explorerUrl) target.explorerUrl = input.explorerUrl;
        return;
      }
    }
  }

  async getUnitEconomics(projectId: string): Promise<UnitEconomicsReport> {
    await this.ensureSeeded();
    const projectTraces = Array.from(this.traceStore.values()).filter(
      (t) => t.projectId === projectId,
    );
    const projectSpans = projectTraces.flatMap((t) => this.spanStore.get(t.id) ?? []);
    const openAlertCount = Array.from(this.alertStore.values()).filter(
      (a) => a.projectId === projectId && a.triageStatus === "OPEN",
    ).length;
    return buildUnitEconomics(projectTraces, projectSpans, openAlertCount);
  }

  async listApiKeys(projectId: string): Promise<StoredApiKey[]> {
    await this.ensureSeeded();
    return Array.from(this.keyStore.values())
      .map((item) => item.record)
      .filter((k) => k.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createApiKey(
    projectId: string,
    name: string,
  ): Promise<{ apiKey: StoredApiKey; plaintextKey: string }> {
    await this.ensureSeeded();
    const plaintextKey = `paaco_live_${randomBytes(18).toString("hex")}`;
    const record: StoredApiKey = {
      id: `key_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      projectId,
      name,
      keyPrefix: `${plaintextKey.slice(0, 14)}...`,
      createdAt: new Date().toISOString(),
    };
    this.keyStore.set(record.id, { record, hash: hashApiKey(plaintextKey) });
    return { apiKey: record, plaintextKey };
  }

  async revokeApiKey(projectId: string, keyId: string): Promise<boolean> {
    const entry = this.keyStore.get(keyId);
    if (!entry || entry.record.projectId !== projectId) return false;
    entry.record.revokedAt = new Date().toISOString();
    return true;
  }

  async resolveProjectIdForApiKey(rawKey: string | null): Promise<string> {
    await this.ensureSeeded();
    if (!rawKey) return DEMO_PROJECT_ID;
    const h = hashApiKey(rawKey.trim());
    for (const entry of this.keyStore.values()) {
      if (entry.hash === h && !entry.record.revokedAt) {
        entry.record.lastUsedAt = new Date().toISOString();
        return entry.record.projectId;
      }
    }
    return DEMO_PROJECT_ID;
  }
}

export class PostgresTraceRepository implements TraceRepository {
  private get db() {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL is not configured");
    return db;
  }

  async ensureProject(projectId: string): Promise<void> {
    await this.db
      .insert(projects)
      .values({ id: projectId, name: projectId === DEMO_PROJECT_ID ? "Paaco Demo Project" : "Workspace" })
      .onConflictDoNothing();
  }

  async ingestBatch(projectId: string, batch: IngestBatchRequest): Promise<IngestOutcome> {
    await this.ensureProject(projectId);
    const normalized = normalizeBatchToRecords(projectId, batch);
    const traceIds: string[] = [];
    const alertsCreated: StoredAlert[] = [];

    for (const item of normalized) {
      await this.db
        .insert(traces)
        .values({
          id: item.trace.id,
          projectId: item.trace.projectId,
          externalTraceId: item.trace.externalTraceId,
          agentId: item.trace.agentId,
          userId: item.trace.userId ?? null,
          sessionId: item.trace.sessionId ?? null,
          userPrompt: item.trace.userPrompt,
          status: item.trace.status,
          startedAt: new Date(item.trace.startedAt),
          endedAt: new Date(item.trace.endedAt),
          durationMs: item.trace.durationMs,
          totalMicroUsd: item.trace.totalMicroUsd,
          llmTokenMicroUsd: item.trace.llmTokenMicroUsd,
          toolPaymentMicroUsd: item.trace.toolPaymentMicroUsd,
          wastedMicroUsd: item.trace.wastedMicroUsd,
          hasAnomalies: item.trace.hasAnomalies,
          anomalyCount: item.trace.anomalyCount,
          isDemo: item.trace.isDemo,
        })
        .onConflictDoUpdate({
          target: traces.id,
          set: {
            endedAt: new Date(item.trace.endedAt),
            durationMs: item.trace.durationMs,
            status: item.trace.status,
            totalMicroUsd: item.trace.totalMicroUsd,
            llmTokenMicroUsd: item.trace.llmTokenMicroUsd,
            toolPaymentMicroUsd: item.trace.toolPaymentMicroUsd,
            wastedMicroUsd: item.trace.wastedMicroUsd,
            hasAnomalies: item.trace.hasAnomalies,
            anomalyCount: item.trace.anomalyCount,
          },
        });

      for (const sp of item.spans) {
        await this.db
          .insert(spans)
          .values({
            id: sp.id,
            traceId: sp.traceId,
            externalSpanId: sp.externalSpanId,
            parentSpanId: sp.parentSpanId ?? null,
            kind: sp.kind,
            name: sp.name,
            status: sp.status,
            startedAt: new Date(sp.startedAt),
            endedAt: new Date(sp.endedAt),
            durationMs: sp.durationMs,
            costMicroUsd: sp.costMicroUsd,
            wastedMicroUsd: sp.wastedMicroUsd,
            model: sp.model ?? null,
            inputTokens: sp.inputTokens ?? null,
            outputTokens: sp.outputTokens ?? null,
            reasoningTokens: sp.reasoningTokens ?? null,
            mcpServer: sp.mcpServer ?? null,
            mcpTool: sp.mcpTool ?? null,
            argsPreview: sp.argsPreview ?? null,
            rail: sp.rail ?? null,
            network: sp.network ?? null,
            asset: sp.asset ?? null,
            payTo: sp.payTo ?? null,
            merchantDomain: sp.merchantDomain ?? null,
            merchantUrl: sp.merchantUrl ?? null,
            httpStatus: sp.httpStatus ?? null,
            challengeHeaderHash: sp.challengeHeaderHash ?? null,
            challengePreview: sp.challengePreview ?? null,
            txHash: sp.txHash ?? null,
            explorerUrl: sp.explorerUrl ?? null,
            facilitatorUrl: sp.facilitatorUrl ?? null,
            settlementStatus: sp.settlementStatus ?? null,
            reconciliationStatus: sp.reconciliationStatus ?? null,
            reconciliationDetail: sp.reconciliationDetail ?? null,
            responseBytes: sp.responseBytes ?? null,
            responsePreview: sp.responsePreview ?? null,
            errorMessage: sp.errorMessage ?? null,
            attributesJson: sp.attributesJson ?? null,
          })
          .onConflictDoNothing();
      }

      for (const al of item.alerts) {
        await this.db
          .insert(forensicAlerts)
          .values({
            id: al.id,
            projectId: al.projectId,
            traceId: al.traceId,
            spanId: al.spanId,
            alertType: al.alertType,
            severity: al.severity,
            wastedMicroUsd: al.wastedMicroUsd,
            summary: al.summary,
            triageStatus: al.triageStatus,
          })
          .onConflictDoNothing();
        alertsCreated.push(al);
      }

      traceIds.push(item.trace.id);
    }

    return { traceIds, alertsCreated };
  }

  private mapTraceRow(r: typeof traces.$inferSelect): StoredTrace {
    return {
      id: r.id,
      projectId: r.projectId,
      externalTraceId: r.externalTraceId,
      agentId: r.agentId,
      userId: r.userId ?? undefined,
      sessionId: r.sessionId ?? undefined,
      userPrompt: r.userPrompt,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
      durationMs: r.durationMs,
      totalMicroUsd: r.totalMicroUsd,
      llmTokenMicroUsd: r.llmTokenMicroUsd,
      toolPaymentMicroUsd: r.toolPaymentMicroUsd,
      wastedMicroUsd: r.wastedMicroUsd,
      hasAnomalies: r.hasAnomalies,
      anomalyCount: r.anomalyCount,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private mapSpanRow(r: typeof spans.$inferSelect): StoredSpan {
    return {
      id: r.id,
      traceId: r.traceId,
      externalSpanId: r.externalSpanId,
      parentSpanId: r.parentSpanId ?? undefined,
      kind: r.kind,
      name: r.name,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
      durationMs: r.durationMs,
      costMicroUsd: r.costMicroUsd,
      wastedMicroUsd: r.wastedMicroUsd,
      model: r.model ?? undefined,
      inputTokens: r.inputTokens ?? undefined,
      outputTokens: r.outputTokens ?? undefined,
      reasoningTokens: r.reasoningTokens ?? undefined,
      mcpServer: r.mcpServer ?? undefined,
      mcpTool: r.mcpTool ?? undefined,
      argsPreview: r.argsPreview ?? undefined,
      rail: r.rail ?? undefined,
      network: r.network ?? undefined,
      asset: r.asset ?? undefined,
      payTo: r.payTo ?? undefined,
      merchantDomain: r.merchantDomain ?? undefined,
      merchantUrl: r.merchantUrl ?? undefined,
      httpStatus: r.httpStatus ?? undefined,
      challengeHeaderHash: r.challengeHeaderHash ?? undefined,
      challengePreview: r.challengePreview ?? undefined,
      txHash: r.txHash ?? undefined,
      explorerUrl: r.explorerUrl ?? undefined,
      facilitatorUrl: r.facilitatorUrl ?? undefined,
      settlementStatus: r.settlementStatus ?? undefined,
      reconciliationStatus: (r.reconciliationStatus as ReconciliationStatus | null) ?? undefined,
      reconciliationDetail: r.reconciliationDetail ?? undefined,
      responseBytes: r.responseBytes ?? undefined,
      responsePreview: r.responsePreview ?? undefined,
      errorMessage: r.errorMessage ?? undefined,
      attributesJson: (r.attributesJson as Record<string, unknown> | null) ?? undefined,
    };
  }

  private mapAlertRow(r: typeof forensicAlerts.$inferSelect): StoredAlert {
    return {
      id: r.id,
      projectId: r.projectId,
      traceId: r.traceId,
      spanId: r.spanId,
      alertType: r.alertType as ForensicAlertType,
      severity: r.severity as AlertSeverity,
      wastedMicroUsd: r.wastedMicroUsd,
      summary: r.summary,
      workflowRunId: r.workflowRunId ?? undefined,
      workflowHookToken: r.workflowHookToken ?? undefined,
      triageStatus: r.triageStatus as TriageStatus,
      triageNote: r.triageNote ?? undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listTraces(projectId: string, filter: Partial<TraceFilter> = {}): Promise<StoredTrace[]> {
    const conds = [eq(traces.projectId, projectId)];
    if (filter.agentId) conds.push(eq(traces.agentId, filter.agentId));
    if (filter.userId) conds.push(eq(traces.userId, filter.userId));
    if (filter.onlyAnomalies) conds.push(eq(traces.hasAnomalies, true));
    if (filter.minWastedMicroUsd !== undefined) {
      conds.push(gte(traces.wastedMicroUsd, filter.minWastedMicroUsd));
    }
    if (filter.minTotalMicroUsd !== undefined) {
      conds.push(gte(traces.totalMicroUsd, filter.minTotalMicroUsd));
    }

    const rows = await this.db
      .select()
      .from(traces)
      .where(and(...conds))
      .orderBy(desc(traces.startedAt))
      .limit(100);

    const normalizedNet = normalizeNetwork(filter.network);
    const domainFilter = filter.merchantDomain?.toLowerCase().trim();
    const q = filter.searchText?.toLowerCase().trim();

    if (!normalizedNet && !domainFilter && !filter.alertType && !q) {
      return rows.slice(0, filter.limit ?? 25).map((r) => this.mapTraceRow(r));
    }

    const out: StoredTrace[] = [];
    for (const row of rows) {
      const mapped = this.mapTraceRow(row);
      const detail = await this.getTraceDetail(projectId, mapped.id);
      if (!detail) continue;
      if (normalizedNet && !detail.spans.some((s) => s.network === normalizedNet)) continue;
      if (
        domainFilter &&
        !detail.spans.some((s) => s.merchantDomain?.toLowerCase().includes(domainFilter))
      ) {
        continue;
      }
      if (filter.alertType && !detail.alerts.some((a) => a.alertType === filter.alertType)) {
        continue;
      }
      if (q) {
        const hay = [
          mapped.id,
          mapped.agentId,
          mapped.userPrompt,
          ...detail.spans.map((s) => `${s.name} ${s.merchantDomain ?? ""} ${s.txHash ?? ""}`),
          ...detail.alerts.map((a) => `${a.alertType} ${a.summary}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(mapped);
      if (out.length >= (filter.limit ?? 25)) break;
    }
    return out;
  }

  async getTraceDetail(projectId: string, traceId: string): Promise<TraceDetail | null> {
    const [row] = await this.db
      .select()
      .from(traces)
      .where(and(eq(traces.projectId, projectId), eq(traces.id, traceId)))
      .limit(1);
    if (!row) return null;

    const spanRows = await this.db
      .select()
      .from(spans)
      .where(eq(spans.traceId, traceId));
    const alertRows = await this.db
      .select()
      .from(forensicAlerts)
      .where(eq(forensicAlerts.traceId, traceId));

    return {
      trace: this.mapTraceRow(row),
      spans: spanRows
        .map((r) => this.mapSpanRow(r))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      alerts: alertRows.map((r) => this.mapAlertRow(r)),
    };
  }

  async listAlerts(projectId: string, status?: TriageStatus): Promise<StoredAlert[]> {
    const conds = [eq(forensicAlerts.projectId, projectId)];
    if (status) conds.push(eq(forensicAlerts.triageStatus, status));
    const rows = await this.db
      .select()
      .from(forensicAlerts)
      .where(and(...conds))
      .orderBy(desc(forensicAlerts.createdAt));
    return rows.map((r) => this.mapAlertRow(r));
  }

  async getAlert(alertId: string): Promise<StoredAlert | null> {
    const [row] = await this.db
      .select()
      .from(forensicAlerts)
      .where(eq(forensicAlerts.id, alertId))
      .limit(1);
    return row ? this.mapAlertRow(row) : null;
  }

  async setAlertWorkflowInfo(
    alertId: string,
    info: { workflowRunId?: string; workflowHookToken?: string },
  ): Promise<void> {
    await this.db
      .update(forensicAlerts)
      .set({
        workflowRunId: info.workflowRunId,
        workflowHookToken: info.workflowHookToken,
        updatedAt: new Date(),
      })
      .where(eq(forensicAlerts.id, alertId));
  }

  async triageAlert(
    alertId: string,
    input: { status: TriageStatus; note?: string },
  ): Promise<StoredAlert | null> {
    const [updated] = await this.db
      .update(forensicAlerts)
      .set({
        triageStatus: input.status,
        triageNote: input.note,
        updatedAt: new Date(),
      })
      .where(eq(forensicAlerts.id, alertId))
      .returning();
    return updated ? this.mapAlertRow(updated) : null;
  }

  async updateSpanReconciliation(
    spanId: string,
    input: { status: ReconciliationStatus; detail: string; explorerUrl?: string },
  ): Promise<void> {
    await this.db
      .update(spans)
      .set({
        reconciliationStatus: input.status,
        reconciliationDetail: input.detail,
        ...(input.explorerUrl ? { explorerUrl: input.explorerUrl } : {}),
      })
      .where(eq(spans.id, spanId));
  }

  async getUnitEconomics(projectId: string): Promise<UnitEconomicsReport> {
    const traceRows = await this.db
      .select()
      .from(traces)
      .where(eq(traces.projectId, projectId));
    const mappedTraces = traceRows.map((r) => this.mapTraceRow(r));
    const spanRows = await this.db
      .select({ span: spans })
      .from(spans)
      .innerJoin(traces, eq(spans.traceId, traces.id))
      .where(eq(traces.projectId, projectId));
    const mappedSpans = spanRows.map((r) => this.mapSpanRow(r.span));
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(forensicAlerts)
      .where(and(eq(forensicAlerts.projectId, projectId), eq(forensicAlerts.triageStatus, "OPEN")));

    return buildUnitEconomics(mappedTraces, mappedSpans, countRow?.count ?? 0);
  }

  async listApiKeys(projectId: string): Promise<StoredApiKey[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.projectId, projectId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      keyPrefix: r.keyPrefix,
      lastUsedAt: r.lastUsedAt?.toISOString(),
      revokedAt: r.revokedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createApiKey(
    projectId: string,
    name: string,
  ): Promise<{ apiKey: StoredApiKey; plaintextKey: string }> {
    await this.ensureProject(projectId);
    const plaintextKey = `paaco_live_${randomBytes(18).toString("hex")}`;
    const id = `key_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const prefix = `${plaintextKey.slice(0, 14)}...`;
    const [inserted] = await this.db
      .insert(apiKeys)
      .values({
        id,
        projectId,
        name,
        keyPrefix: prefix,
        keyHash: hashApiKey(plaintextKey),
      })
      .returning();

    return {
      plaintextKey,
      apiKey: {
        id: inserted!.id,
        projectId: inserted!.projectId,
        name: inserted!.name,
        keyPrefix: inserted!.keyPrefix,
        createdAt: inserted!.createdAt.toISOString(),
      },
    };
  }

  async revokeApiKey(projectId: string, keyId: string): Promise<boolean> {
    const res = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
      .returning();
    return res.length > 0;
  }

  async resolveProjectIdForApiKey(rawKey: string | null): Promise<string> {
    if (!rawKey) return DEMO_PROJECT_ID;
    const hashed = hashApiKey(rawKey.trim());
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashed))
      .limit(1);
    if (!row || row.revokedAt) return DEMO_PROJECT_ID;
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id));
    return row.projectId;
  }
}

const globalRepoKey = "__paacoMemoryRepo" as const;
const globalWithRepo = globalThis as typeof globalThis & {
  [globalRepoKey]?: InMemoryTraceRepository;
};

export function getRepository(): TraceRepository {
  if (getDb()) {
    return new PostgresTraceRepository();
  }
  if (!globalWithRepo[globalRepoKey]) {
    globalWithRepo[globalRepoKey] = new InMemoryTraceRepository();
  }
  return globalWithRepo[globalRepoKey];
}
