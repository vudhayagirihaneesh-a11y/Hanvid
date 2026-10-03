/**
 * In-memory live status for in-flight generations, keyed by assistant
 * messageId. The DB only stores durable state; this holds fast-changing
 * fields (queue position, ETA, phase) so the REST polling fallback shows
 * real progress even when the realtime socket service isn't running.
 */

export type GenPhase = "warming" | "queued" | "generating" | "finalizing";

export interface LiveStatus {
  status: "pending" | "generating" | "ready" | "failed";
  progress: number;
  phase?: GenPhase;
  queuePosition?: number;
  queueLength?: number;
  etaSeconds?: number;
  updatedAt: number;
}

const g = globalThis as unknown as { __wanvidLive?: Map<string, LiveStatus> };
if (!g.__wanvidLive) g.__wanvidLive = new Map();
const store = g.__wanvidLive;

export function setLiveStatus(messageId: string, s: Omit<LiveStatus, "updatedAt">) {
  store.set(messageId, { ...s, updatedAt: Date.now() });
  // Drop terminal entries after a while to avoid unbounded growth.
  if (s.status === "ready" || s.status === "failed") {
    setTimeout(() => store.delete(messageId), 5 * 60 * 1000).unref?.();
  }
}

export function getLiveStatus(messageId: string): LiveStatus | undefined {
  return store.get(messageId);
}
