import type {
  DetectedAlert,
  EconomicSummary,
  SpanInput,
} from "./trace-schema.js";

const GARBAGE_BODY_PATTERNS = [
  /<!doctype\s+html/i,
  /<html[\s>]/i,
  /"error"\s*:\s*"(rate.?limit|internal|unavailable|empty|bad gateway)/i,
  /^(\s*\{\s*\}\s*|\s*\[\s*\]\s*|\s*null\s*|\s*undefined\s*)$/i,
  /502 bad gateway|504 gateway time-?out|service unavailable/i,
];

function extractUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname;
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

function isSettled(span: SpanInput): boolean {
  const payment = span.payment;
  if (!payment) return false;
  return (
    payment.settlementStatus === "settled" ||
    payment.settlementStatus === "ghost_payment" ||
    Boolean(payment.txHash)
  );
}

/**
 * Flags settled HTTP payments whose downstream response failed (`>= 500`, `408`, timeout, or span error).
 */
export function detectGhostPayments(spans: SpanInput[]): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];

  for (const span of spans) {
    const payment = span.payment;
    if (!payment || !isSettled(span)) continue;

    const httpStatus = payment.httpStatus ?? 0;
    const isHttpFailure = httpStatus >= 500 || httpStatus === 408 || httpStatus === 429;
    const isSpanFailure = span.status === "timeout" || span.status === "error";

    if (isHttpFailure || isSpanFailure) {
      const reason = httpStatus
        ? `HTTP ${httpStatus}`
        : span.status === "timeout"
          ? "request timeout"
          : "downstream error";
      alerts.push({
        spanId: span.spanId,
        alertType: "GHOST_PAYMENT",
        severity: "critical",
        wastedMicroUsd: payment.amountMicroUsd,
        summary: `Ghost payment on ${payment.merchantDomain}: payment settled (${payment.txHash ?? "tx"}) but merchant returned ${reason}.`,
      });
    }
  }

  return alerts;
}

/**
 * Flags runaway loop retries: >= 3 paid calls to the same (merchantDomain, path) within one trace
 * or duplicate retries to the same (merchantDomain, payTo, amountMicroUsd) after a failure/timeout.
 */
export function detectLoopBurn(spans: SpanInput[]): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const byEndpoint = new Map<string, SpanInput[]>();
  const byPaymentTarget = new Map<string, SpanInput[]>();

  for (const span of spans) {
    const payment = span.payment;
    if (!payment || !isSettled(span)) continue;

    const endpointKey = `${payment.merchantDomain}|${extractUrlPath(payment.merchantUrl)}`;
    const list = byEndpoint.get(endpointKey) ?? [];
    list.push(span);
    byEndpoint.set(endpointKey, list);

    const targetKey = `${payment.merchantDomain}|${payment.payTo}|${payment.amountMicroUsd}`;
    const targetList = byPaymentTarget.get(targetKey) ?? [];
    targetList.push(span);
    byPaymentTarget.set(targetKey, targetList);
  }

  const flaggedSpanIds = new Set<string>();

  for (const [, group] of byEndpoint) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    // First call is treated as legitimate intent; subsequent redundant loop calls are wasted.
    for (let i = 1; i < sorted.length; i++) {
      const span = sorted[i];
      if (!span?.payment) continue;
      flaggedSpanIds.add(span.spanId);
      alerts.push({
        spanId: span.spanId,
        alertType: "LOOP_BURN",
        severity: "high",
        wastedMicroUsd: span.payment.amountMicroUsd,
        summary: `Retry loop burn (${i + 1}/${sorted.length}) hitting ${span.payment.merchantDomain}${extractUrlPath(span.payment.merchantUrl)}.`,
      });
    }
  }

  for (const [, group] of byPaymentTarget) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const hadPriorFailure = sorted.some(
      (s) =>
        s.status !== "ok" ||
        (s.payment?.httpStatus !== undefined && s.payment.httpStatus >= 400),
    );
    if (!hadPriorFailure) continue;

    for (let i = 1; i < sorted.length; i++) {
      const span = sorted[i];
      if (!span?.payment || flaggedSpanIds.has(span.spanId)) continue;
      flaggedSpanIds.add(span.spanId);
      alerts.push({
        spanId: span.spanId,
        alertType: "LOOP_BURN",
        severity: "high",
        wastedMicroUsd: span.payment.amountMicroUsd,
        summary: `Duplicate paid retry to ${span.payment.merchantDomain} after failed/timed-out attempt.`,
      });
    }
  }

  return alerts;
}

/**
 * Flags settled HTTP 200 payments where the merchant delivered empty, malformed, or error-page payloads.
 */
export function detectGarbageDelivery(spans: SpanInput[]): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];

  for (const span of spans) {
    const payment = span.payment;
    if (!payment || !isSettled(span)) continue;
    if (span.status !== "ok") continue;
    if (payment.httpStatus !== undefined && (payment.httpStatus < 200 || payment.httpStatus >= 300)) {
      continue;
    }

    const explicitGarbage = span.attributes?.isGarbageBody === true;
    const tinyBody = payment.responseBytes !== undefined && payment.responseBytes < 16;
    const preview = payment.responsePreview ?? "";
    const patternHit = preview.length > 0 && GARBAGE_BODY_PATTERNS.some((re) => re.test(preview));

    if (explicitGarbage || tinyBody || patternHit) {
      const detail = tinyBody
        ? `only ${payment.responseBytes} bytes`
        : "HTML error or empty/error payload";
      alerts.push({
        spanId: span.spanId,
        alertType: "GARBAGE_DELIVERY",
        severity: "high",
        wastedMicroUsd: payment.amountMicroUsd,
        summary: `Garbage delivery from ${payment.merchantDomain}: payment settled for HTTP 200 containing ${detail}.`,
      });
    }
  }

  return alerts;
}

/**
 * Computes all deterministic financial forensic alerts and unit-economic totals for a trace's spans.
 */
export function analyzeTraceForensics(spans: SpanInput[]): {
  alerts: DetectedAlert[];
  summary: EconomicSummary;
} {
  const ghostAlerts = detectGhostPayments(spans);
  const loopAlerts = detectLoopBurn(spans);
  const garbageAlerts = detectGarbageDelivery(spans);

  const alerts = [...ghostAlerts, ...loopAlerts, ...garbageAlerts];

  // Prevent double-counting wasted USD when the same span triggers multiple detectors
  // (e.g., Ghost Payment on call #1 + Loop Burn on call #2/#3).
  const maxWasteBySpan = new Map<string, number>();
  for (const alert of alerts) {
    const current = maxWasteBySpan.get(alert.spanId) ?? 0;
    if (alert.wastedMicroUsd > current) {
      maxWasteBySpan.set(alert.spanId, alert.wastedMicroUsd);
    }
  }

  let llmTokenMicroUsd = 0;
  let toolPaymentMicroUsd = 0;
  let settledCount = 0;

  for (const span of spans) {
    if (span.llm) {
      llmTokenMicroUsd += span.llm.costMicroUsd;
    }
    if (span.payment && isSettled(span)) {
      toolPaymentMicroUsd += span.payment.amountMicroUsd;
      settledCount += 1;
    }
  }

  let wastedMicroUsd = 0;
  for (const amount of maxWasteBySpan.values()) {
    wastedMicroUsd += amount;
  }

  return {
    alerts,
    summary: {
      totalMicroUsd: llmTokenMicroUsd + toolPaymentMicroUsd,
      llmTokenMicroUsd,
      toolPaymentMicroUsd,
      wastedMicroUsd,
      settledCount,
      ghostCount: ghostAlerts.length,
      loopCount: loopAlerts.length,
      garbageCount: garbageAlerts.length,
    },
  };
}
