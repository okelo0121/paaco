import {
  BASE_SEPOLIA_CAIP2,
  SOLANA_DEVNET_CAIP2,
  normalizeNetwork,
} from "./networks.js";
import {
  sanitizeUntrustedText,
  type IngestBatchRequest,
  type PaymentRail,
  type SpanInput,
  type SpanKind,
  type TraceInput,
} from "./trace-schema.js";

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  status?: { code?: number; message?: string };
  attributes?: OtlpKeyValue[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: Array<{
    spans?: OtlpSpan[];
  }>;
}

interface OtlpRequestBody {
  resourceSpans?: OtlpResourceSpans[];
}

function readAttrs(list?: OtlpKeyValue[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!list) return out;
  for (const item of list) {
    if (!item.key || !item.value) continue;
    const val = item.value;
    if (val.stringValue !== undefined) out[item.key] = val.stringValue;
    else if (val.intValue !== undefined) out[item.key] = Number(val.intValue);
    else if (val.doubleValue !== undefined) out[item.key] = val.doubleValue;
    else if (val.boolValue !== undefined) out[item.key] = val.boolValue;
  }
  return out;
}

function nanoToIso(ns?: string | number): string {
  if (ns === undefined || ns === null || ns === "") {
    return new Date().toISOString();
  }
  const big = typeof ns === "number" ? Math.trunc(ns) : Number(BigInt(ns) / 1_000_000n);
  if (!Number.isFinite(big) || big <= 0) return new Date().toISOString();
  // Handle both ms and ns inputs safely
  const ms = big > 1e15 ? Math.trunc(big / 1_000_000) : big;
  return new Date(ms).toISOString();
}

function estimateLlmCostMicroUsd(inputTokens: number, outputTokens: number): number {
  // Default blended conservative estimate ($1.50/1M in, $6.00/1M out) when explicit cost isn't supplied
  return Math.round(inputTokens * 1.5 + outputTokens * 6.0);
}

function inferDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "unknown.merchant";
  }
}

function inferRail(network: string, explicitRail?: string): PaymentRail {
  if (
    explicitRail === "x402_solana" ||
    explicitRail === "x402_evm" ||
    explicitRail === "stripe" ||
    explicitRail === "llm_tokens" ||
    explicitRail === "api_credit"
  ) {
    return explicitRail;
  }
  if (network.startsWith("solana:")) return "x402_solana";
  if (network.startsWith("eip155:")) return "x402_evm";
  return "api_credit";
}

/**
 * Translates an OpenTelemetry OTLP/JSON `resourceSpans` payload into canonical Paaco traces and spans.
 */
export function parseOtlpTracesRequest(rawBody: unknown): IngestBatchRequest {
  const body = (rawBody ?? {}) as OtlpRequestBody;
  const resourceSpans = Array.isArray(body.resourceSpans) ? body.resourceSpans : [];

  const tracesById = new Map<string, TraceInput>();
  const spans: SpanInput[] = [];

  for (const rs of resourceSpans) {
    const resAttrs = readAttrs(rs.resource?.attributes);
    const serviceName = String(
      resAttrs["paaco.agent_id"] ?? resAttrs["service.name"] ?? "otel-agent",
    );

    for (const ss of rs.scopeSpans ?? []) {
      for (const rawSpan of ss.spans ?? []) {
        if (!rawSpan.traceId || !rawSpan.spanId) continue;
        const attrs = readAttrs(rawSpan.attributes);
        const startedAt = nanoToIso(rawSpan.startTimeUnixNano);
        const endedAt = nanoToIso(rawSpan.endTimeUnixNano ?? rawSpan.startTimeUnixNano);
        const isError = rawSpan.status?.code === 2;
        const errorMsg = rawSpan.status?.message
          ? sanitizeUntrustedText(rawSpan.status.message, 500)
          : undefined;
        const isTimeout = Boolean(
          errorMsg?.toLowerCase().includes("timeout") ||
            Number(attrs["http.response.status_code"] ?? 0) === 504 ||
            Number(attrs["http.status_code"] ?? 0) === 504,
        );
        const status = isTimeout ? "timeout" : isError ? "error" : "ok";

        const model = attrs["gen_ai.request.model"] ?? attrs["ai.model.id"];
        const mcpTool = attrs["mcp.tool.name"];
        const hasPayment =
          attrs["x402.amount_micro_usd"] !== undefined ||
          attrs["paaco.payment.amount_micro_usd"] !== undefined ||
          attrs["x402.tx_hash"] !== undefined ||
          attrs["paaco.payment.tx_hash"] !== undefined;

        let kind: SpanKind = "custom";
        if (hasPayment) kind = "http_payment";
        else if (mcpTool) kind = "mcp_tool";
        else if (model) kind = "llm";

        const spanInput: SpanInput = {
          spanId: rawSpan.spanId,
          traceId: rawSpan.traceId,
          parentSpanId: rawSpan.parentSpanId || undefined,
          kind,
          name: sanitizeUntrustedText(rawSpan.name || "otel.span", 256),
          startedAt,
          endedAt,
          status,
          errorMessage: errorMsg,
          attributes: attrs,
        };

        if (kind === "llm") {
          const inputTokens = Number(attrs["gen_ai.usage.input_tokens"] ?? 0);
          const outputTokens = Number(attrs["gen_ai.usage.output_tokens"] ?? 0);
          const reasoningTokens = Number(attrs["gen_ai.usage.reasoning_tokens"] ?? 0);
          const explicitCost = attrs["paaco.llm.cost_micro_usd"] ?? attrs["gen_ai.usage.cost_micro_usd"];
          spanInput.llm = {
            model: String(model ?? "unknown"),
            inputTokens: Math.max(0, Math.trunc(inputTokens)),
            outputTokens: Math.max(0, Math.trunc(outputTokens)),
            reasoningTokens: Math.max(0, Math.trunc(reasoningTokens)),
            costMicroUsd:
              explicitCost !== undefined
                ? Math.max(0, Math.trunc(Number(explicitCost)))
                : estimateLlmCostMicroUsd(inputTokens, outputTokens),
          };
        }

        if (kind === "mcp_tool") {
          spanInput.mcp = {
            serverName: String(attrs["mcp.server.name"] ?? "mcp-server"),
            toolName: String(mcpTool ?? rawSpan.name),
            argsPreview: attrs["mcp.tool.args"]
              ? sanitizeUntrustedText(String(attrs["mcp.tool.args"]), 500)
              : undefined,
            responseBytes: Number(attrs["mcp.response.bytes"] ?? 0),
            isEmptyOrError: status !== "ok",
          };
        }

        if (kind === "http_payment") {
          const rawNet = String(
            attrs["x402.network"] ??
              attrs["paaco.payment.network"] ??
              SOLANA_DEVNET_CAIP2,
          );
          const network = normalizeNetwork(rawNet) ?? BASE_SEPOLIA_CAIP2;
          const merchantUrl = String(
            attrs["url.full"] ?? attrs["http.url"] ?? "https://merchant.unknown/x402",
          );
          const httpStatus = Number(
            attrs["http.response.status_code"] ?? attrs["http.status_code"] ?? 200,
          );
          const txHash =
            attrs["x402.tx_hash"] !== undefined
              ? String(attrs["x402.tx_hash"])
              : attrs["paaco.payment.tx_hash"] !== undefined
                ? String(attrs["paaco.payment.tx_hash"])
                : undefined;

          spanInput.payment = {
            rail: inferRail(
              network,
              attrs["paaco.payment.rail"] ? String(attrs["paaco.payment.rail"]) : undefined,
            ),
            network,
            asset: String(attrs["x402.asset"] ?? "USDC"),
            amountMicroUsd: Math.max(
              0,
              Math.trunc(
                Number(
                  attrs["x402.amount_micro_usd"] ??
                    attrs["paaco.payment.amount_micro_usd"] ??
                    0,
                ),
              ),
            ),
            payTo: String(attrs["x402.pay_to"] ?? attrs["paaco.payment.pay_to"] ?? "unknown"),
            merchantUrl: sanitizeUntrustedText(merchantUrl, 2048),
            merchantDomain: inferDomain(merchantUrl),
            httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined,
            txHash,
            settlementStatus: txHash
              ? status === "ok"
                ? "settled"
                : "ghost_payment"
              : status === "ok"
                ? "quoted"
                : "failed",
            responseBytes:
              attrs["http.response.body.size"] !== undefined
                ? Number(attrs["http.response.body.size"])
                : undefined,
          };
        }

        spans.push(spanInput);

        const existingTrace = tracesById.get(rawSpan.traceId);
        if (!existingTrace) {
          tracesById.set(rawSpan.traceId, {
            traceId: rawSpan.traceId,
            agentId: String(attrs["paaco.agent_id"] ?? serviceName),
            userId: attrs["enduser.id"] ? String(attrs["enduser.id"]) : undefined,
            sessionId: attrs["session.id"] ? String(attrs["session.id"]) : undefined,
            userPrompt: sanitizeUntrustedText(
              String(
                attrs["paaco.user_prompt"] ??
                  attrs["gen_ai.prompt"] ??
                  rawSpan.name ??
                  "OTel traced agent run",
              ),
              2000,
            ),
            startedAt,
            endedAt,
            status,
          });
        } else {
          if (startedAt < existingTrace.startedAt) existingTrace.startedAt = startedAt;
          if (!existingTrace.endedAt || endedAt > existingTrace.endedAt) {
            existingTrace.endedAt = endedAt;
          }
          if (status !== "ok") existingTrace.status = status;
        }
      }
    }
  }

  return {
    traces: Array.from(tracesById.values()),
    spans,
  };
}
