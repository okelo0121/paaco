import { AsyncLocalStorage } from "node:async_hooks";

export interface PaacoTraceContext {
  traceId: string;
  currentSpanId?: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
}

export const traceStorage = new AsyncLocalStorage<PaacoTraceContext>();

export function getActiveTraceContext(): PaacoTraceContext | undefined {
  return traceStorage.getStore();
}
