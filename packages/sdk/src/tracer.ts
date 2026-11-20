import {
  BASE_SEPOLIA_CAIP2,
  SOLANA_DEVNET_CAIP2,
  sanitizeUntrustedText,
  type IngestBatchRequest,
  type SpanInput,
  type TraceInput,
} from "@paaco/shared";
import { randomUUID } from "node:crypto";
import { getActiveTraceContext, traceStorage } from "./context.js";
import {
  parseX402ChallengeFromResponse,
  parseX402ReceiptHeader,
  type ParsedX402Challenge,
} from "./x402-parser.js";

export interface PaacoTracerConfig {
  apiKey: string;
  agentId: string;
  endpoint?: string;
  /** Optional custom fetch implementation used only for sending telemetry batches */
  transportFetch?: typeof fetch;
  /** Optional error hook; Paaco never throws telemetry errors into caller agent logic */
  onError?: (err: unknown) => void;
}

export interface RunTraceOptions {
  traceId?: string;
  userPrompt: string;
  userId?: string;
  sessionId?: string;
  isDemo?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RecordLlmStepInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costMicroUsd?: number;
  durationMs?: number;
  name?: string;
  status?: "ok" | "error";
  errorMessage?: string;
}

export interface McpClientLike {
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  listTools?: () => Promise<unknown>;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getHeaderCaseInsensitive(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === target) return v;
    }
    return null;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === "string") return v;
  }
  return null;
}

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "unknown.merchant";
  }
}

function estimateLlmCostMicroUsd(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * 1.5 + outputTokens * 6.0);
}

async function inspectResponseSafely(
  response: Response,
): Promise<{ bytes: number; preview: string }> {
  try {
    if (typeof response.clone !== "function") {
      const lenHeader = response.headers.get("content-length");
      return { bytes: lenHeader ? Number(lenHeader) : 0, preview: "" };
    }
    const cloned = response.clone();
    const text = await cloned.text();
    return {
      bytes: Buffer.byteLength(text, "utf8"),
      preview: sanitizeUntrustedText(text, 500),
    };
  } catch {
    return { bytes: 0, preview: "" };
  }
}

export class PaacoTracer {
  private readonly apiKey: string;
  private readonly agentId: string;
  private readonly endpoint: string;
  private readonly transportFetch: typeof fetch;
  private readonly onError?: (err: unknown) => void;

  private readonly pendingTraces = new Map<string, TraceInput>();
  private readonly pendingSpans: SpanInput[] = [];
  private readonly pendingChallenges = new Map<string, ParsedX402Challenge>();

  constructor(config: PaacoTracerConfig) {
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.endpoint = (config.endpoint ?? "http://localhost:3000").replace(/\/+$/, "");
    this.transportFetch = config.transportFetch ?? globalThis.fetch;
    this.onError = config.onError;
  }

  /**
   * Executes an agent run within a traced context and flushes captured telemetry non-blockingly.
   */
  async runTrace<T>(options: RunTraceOptions, fn: () => Promise<T>): Promise<T> {
    const traceId = options.traceId ?? `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const startedAt = new Date().toISOString();

    const trace: TraceInput = {
      traceId,
      agentId: this.agentId,
      userId: options.userId,
      sessionId: options.sessionId,
      userPrompt: sanitizeUntrustedText(options.userPrompt, 2000),
      startedAt,
      status: "ok",
      isDemo: options.isDemo,
      metadata: options.metadata,
    };
    this.pendingTraces.set(traceId, trace);

    try {
      const result = await traceStorage.run(
        {
          traceId,
          agentId: this.agentId,
          userId: options.userId,
          sessionId: options.sessionId,
        },
        fn,
      );
      trace.endedAt = new Date().toISOString();
      return result;
    } catch (err) {
      trace.endedAt = new Date().toISOString();
      trace.status = "error";
      throw err;
    } finally {
      await this.flush();
    }
  }

  recordLlmStep(input: RecordLlmStepInput): SpanInput {
    const ctx = getActiveTraceContext();
    const traceId = ctx?.traceId ?? `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = Date.now();
    const duration = Math.max(1, input.durationMs ?? 250);
    const span: SpanInput = {
      spanId: `sp_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      traceId,
      parentSpanId: ctx?.currentSpanId,
      kind: "llm",
      name: sanitizeUntrustedText(input.name ?? `llm.${input.model}`, 256),
      startedAt: new Date(now - duration).toISOString(),
      endedAt: new Date(now).toISOString(),
      status: input.status ?? "ok",
      errorMessage: input.errorMessage,
      llm: {
        model: input.model,
        inputTokens: Math.max(0, Math.trunc(input.inputTokens)),
        outputTokens: Math.max(0, Math.trunc(input.outputTokens)),
        reasoningTokens: Math.max(0, Math.trunc(input.reasoningTokens ?? 0)),
        costMicroUsd:
          input.costMicroUsd ??
          estimateLlmCostMicroUsd(input.inputTokens, input.outputTokens),
      },
    };
    this.pendingSpans.push(span);
    return span;
  }

  /**
   * Returns a Vercel AI SDK `onStepFinish` compatible callback that records LLM token usage & cost.
   */
  createAiSdkOnStepFinish(modelName: string) {
    return (step: {
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      };
    }) => {
      const inputTokens = step.usage?.inputTokens ?? step.usage?.promptTokens ?? 0;
      const outputTokens = step.usage?.outputTokens ?? step.usage?.completionTokens ?? 0;
      this.recordLlmStep({
        model: modelName,
        inputTokens,
        outputTokens,
      });
    };
  }

  /**
   * Wraps an MCP client so every `callTool` invocation becomes a parent span for downstream paid HTTP calls.
   */
  wrapMcpClient<TClient extends McpClientLike>(
    client: TClient,
    serverName: string,
  ): Omit<TClient, "callTool"> & { callTool: McpClientLike["callTool"] } {
    const tracer = this;
    const wrapped = Object.create(Object.getPrototypeOf(client)) as Omit<TClient, "callTool"> & {
      callTool: McpClientLike["callTool"];
    };
    Object.assign(wrapped, client);

    wrapped.callTool = async (params) => {
      const ctx = getActiveTraceContext();
      const traceId = ctx?.traceId ?? `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const spanId = `sp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const startedAt = new Date().toISOString();

      let status: "ok" | "error" = "ok";
      let errorMessage: string | undefined;
      let responseBytes = 0;

      try {
        const result = await traceStorage.run(
          {
            traceId,
            currentSpanId: spanId,
            agentId: ctx?.agentId ?? tracer.agentId,
            userId: ctx?.userId,
            sessionId: ctx?.sessionId,
          },
          () => client.callTool(params),
        );
        try {
          responseBytes = Buffer.byteLength(JSON.stringify(result ?? ""), "utf8");
        } catch {
          responseBytes = 0;
        }
        return result;
      } catch (err) {
        status = "error";
        errorMessage = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        tracer.pendingSpans.push({
          spanId,
          traceId,
          parentSpanId: ctx?.currentSpanId,
          kind: "mcp_tool",
          name: `mcp.${serverName}.${params.name}`,
          startedAt,
          endedAt: new Date().toISOString(),
          status,
          errorMessage: errorMessage ? sanitizeUntrustedText(errorMessage, 500) : undefined,
          mcp: {
            serverName,
            toolName: params.name,
            argsPreview: params.arguments
              ? sanitizeUntrustedText(JSON.stringify(params.arguments), 450)
              : undefined,
            responseBytes,
            isEmptyOrError: status !== "ok" || responseBytes < 4,
          },
        });
      }
    };

    return wrapped;
  }

  /**
   * Passively wraps native `fetch` or `@x402/fetch` without holding private keys or blocking requests.
   */
  wrapFetch(baseFetch: typeof fetch): typeof fetch {
    const tracer = this;

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const ctx = getActiveTraceContext();
      const traceId = ctx?.traceId ?? `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const url = getRequestUrl(input);
      const domain = extractDomain(url);
      const startedAt = new Date().toISOString();
      const spanId = `sp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

      const outboundPaymentSig =
        getHeaderCaseInsensitive(init?.headers, "payment-signature") ??
        getHeaderCaseInsensitive(init?.headers, "x-payment");

      try {
        const response = await baseFetch(input, init);
        const endedAt = new Date().toISOString();

        if (response.status === 402) {
          const headerVal =
            response.headers.get("payment-required") ??
            response.headers.get("x-payment-required");
          const inspected = await inspectResponseSafely(response);
          const challenge = parseX402ChallengeFromResponse(
            headerVal,
            inspected.preview || null,
          );
          if (challenge) {
            tracer.pendingChallenges.set(`${traceId}|${url}`, challenge);
            tracer.pendingSpans.push({
              spanId,
              traceId,
              parentSpanId: ctx?.currentSpanId,
              kind: "http_payment",
              name: `x402.quote ${domain}`,
              startedAt,
              endedAt,
              status: "ok",
              payment: {
                rail: challenge.rail,
                network: challenge.network,
                asset: challenge.asset,
                amountMicroUsd: challenge.amountMicroUsd,
                payTo: challenge.payTo,
                merchantUrl: sanitizeUntrustedText(url, 2048),
                merchantDomain: domain,
                httpStatus: 402,
                challengeHeaderHash: challenge.challengeHeaderHash,
                challengePreview: challenge.challengePreview,
                facilitatorUrl: challenge.facilitatorUrl,
                settlementStatus: "quoted",
              },
            });
          }
          return response;
        }

        const receiptHeader =
          response.headers.get("payment-response") ??
          response.headers.get("x-payment-response");
        const parsedReceipt = parseX402ReceiptHeader(receiptHeader);
        const priorChallenge = tracer.pendingChallenges.get(`${traceId}|${url}`);

        if (priorChallenge || outboundPaymentSig || parsedReceipt) {
          if (priorChallenge) {
            tracer.pendingChallenges.delete(`${traceId}|${url}`);
          }
          const inspected = await inspectResponseSafely(response);
          const network =
            parsedReceipt?.network ?? priorChallenge?.network ?? SOLANA_DEVNET_CAIP2;
          const amountMicroUsd =
            parsedReceipt?.amountMicroUsd ?? priorChallenge?.amountMicroUsd ?? 0;
          const payTo = parsedReceipt?.payTo ?? priorChallenge?.payTo ?? "unknown";
          const asset = parsedReceipt?.asset ?? priorChallenge?.asset ?? "USDC";
          const rail =
            priorChallenge?.rail ??
            (network.startsWith("eip155:") ? "x402_evm" : "x402_solana");

          const isHttpFail = response.status >= 500 || response.status === 408;
          const txHash = parsedReceipt?.txHash;
          const settlementStatus = txHash
            ? isHttpFail
              ? "ghost_payment"
              : "settled"
            : outboundPaymentSig
              ? isHttpFail
                ? "ghost_payment"
                : "submitted"
              : "settled";

          tracer.pendingSpans.push({
            spanId,
            traceId,
            parentSpanId: ctx?.currentSpanId,
            kind: "http_payment",
            name: `x402.pay ${domain}`,
            startedAt,
            endedAt,
            status: response.status === 504 || response.status === 408
              ? "timeout"
              : response.status >= 400
                ? "error"
                : "ok",
            payment: {
              rail: network === BASE_SEPOLIA_CAIP2 ? "x402_evm" : rail,
              network,
              asset,
              amountMicroUsd,
              payTo,
              merchantUrl: sanitizeUntrustedText(url, 2048),
              merchantDomain: domain,
              httpStatus: response.status,
              challengeHeaderHash: priorChallenge?.challengeHeaderHash,
              challengePreview: priorChallenge?.challengePreview,
              txHash,
              facilitatorUrl: priorChallenge?.facilitatorUrl,
              settlementStatus,
              responseBytes: inspected.bytes,
              responsePreview: inspected.preview,
            },
          });
        }

        return response;
      } catch (err) {
        const endedAt = new Date().toISOString();
        const priorChallenge = tracer.pendingChallenges.get(`${traceId}|${url}`);
        if (priorChallenge || outboundPaymentSig) {
          const message = err instanceof Error ? err.message : String(err);
          const isTimeout = message.toLowerCase().includes("timeout") ||
            message.toLowerCase().includes("abort");
          tracer.pendingSpans.push({
            spanId,
            traceId,
            parentSpanId: ctx?.currentSpanId,
            kind: "http_payment",
            name: `x402.pay ${domain}`,
            startedAt,
            endedAt,
            status: isTimeout ? "timeout" : "error",
            errorMessage: sanitizeUntrustedText(message, 500),
            payment: {
              rail: priorChallenge?.rail ?? "x402_solana",
              network: priorChallenge?.network ?? SOLANA_DEVNET_CAIP2,
              asset: priorChallenge?.asset ?? "USDC",
              amountMicroUsd: priorChallenge?.amountMicroUsd ?? 0,
              payTo: priorChallenge?.payTo ?? "unknown",
              merchantUrl: sanitizeUntrustedText(url, 2048),
              merchantDomain: domain,
              httpStatus: isTimeout ? 504 : 500,
              challengeHeaderHash: priorChallenge?.challengeHeaderHash,
              settlementStatus: "ghost_payment",
            },
          });
        }
        throw err;
      }
    };
  }

  /**
   * Flushes buffered traces and spans to Paaco non-blockingly. Never throws on network/ingest errors.
   */
  async flush(): Promise<boolean> {
    if (this.pendingSpans.length === 0 && this.pendingTraces.size === 0) {
      return true;
    }

    const traces = Array.from(this.pendingTraces.values());
    const spans = this.pendingSpans.splice(0, this.pendingSpans.length);
    this.pendingTraces.clear();

    if (spans.length === 0) {
      return true;
    }

    const payload: IngestBatchRequest = { traces, spans };

    try {
      const res = await this.transportFetch(`${this.endpoint}/api/v1/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-paaco-key": this.apiKey,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) {
        this.onError?.(new Error(`Paaco ingest returned HTTP ${res.status}`));
        return false;
      }
      return true;
    } catch (err) {
      this.onError?.(err);
      return false;
    }
  }
}

export function createPaacoTracer(config: PaacoTracerConfig): PaacoTracer {
  return new PaacoTracer(config);
}
