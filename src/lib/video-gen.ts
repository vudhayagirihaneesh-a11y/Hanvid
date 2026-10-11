import { db } from "@/lib/db";
import { MODEL_SERVICE_BASE } from "@/lib/constants";
import type { GenPhase } from "@/lib/live-status";

/**
 * Video generation orchestration.
 *
 * Strategy:
 * 1. Wait (patiently) for the local Python Wan 2.2 service to be up and the
 *    model loaded — users see a "warming up" state instead of an error.
 * 2. Submit the job; the service queues it FIFO on the single GPU.
 * 3. Poll until done, surfacing queue position + ETA while waiting.
 * 4. If the service restarts mid-job (task lost), resubmit transparently.
 *
 * Progress is reported through onProgress (pushed to browsers by the API route).
 */

export interface GenProgress {
  status: "pending" | "generating" | "ready" | "failed";
  progress: number; // 0-100
  phase?: GenPhase;
  queuePosition?: number;
  queueLength?: number;
  etaSeconds?: number;
  videoUrl?: string;
  source?: "local";
  errorMessage?: string;
  duration?: number;
  width?: number;
  height?: number;
  /** Internal: the service lost the task (restart) — safe to resubmit. */
  lost?: boolean;
}

const WARMUP_TIMEOUT_MS = 10 * 60 * 1000; // wait up to 10 min for the model to come up
const JOB_TIMEOUT_MS = 45 * 60 * 1000; // queue wait + generation
const MAX_RESUBMITS = 2;
const POLL_INTERVAL_MS = 2500;

const FRIENDLY_FAILURE =
  "We couldn't generate this video right now. Please try again in a moment.";

/** Check whether the local Python model service is available and ready.
 * Note: `modelLoaded` is true for real generation; a `demo`-mode service is
 * also ready (it produces placeholder videos), so callers accept either. */
export async function checkLocalService(): Promise<{
  available: boolean;
  modelLoaded: boolean;
  mode?: string;
  queue?: { waiting: number; running: boolean; avg_seconds: number; wait_seconds: number };
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${MODEL_SERVICE_BASE}/health`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "ngrok-skip-browser-warning": "69420" }
    });
    clearTimeout(timeout);
    if (!res.ok) return { available: false, modelLoaded: false };
    const data = await res.json();
    return {
      available: true,
      modelLoaded: data.model_loaded === true || data.mode === "demo",
      mode: data.mode,
      queue: data.queue,
    };
  } catch {
    return { available: false, modelLoaded: false };
  }
}

/** Block until the service is up with the model loaded, or the timeout passes. */
async function waitForService(onProgress?: (p: GenProgress) => void): Promise<boolean> {
  const deadline = Date.now() + WARMUP_TIMEOUT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    const s = await checkLocalService();
    if (s.available && s.modelLoaded) return true;
    if (!announced) {
      onProgress?.({ status: "pending", progress: 0, phase: "warming", source: "local" });
      announced = true;
    }
    await sleep(5000);
  }
  return false;
}

/** Submit a generation job to the local Python service (with retries). */
export async function submitLocalJob(
  prompt: string,
  messageId: string,
  resolution: string = "2k",
): Promise<string | null> {
  // 3 quick attempts — the caller surfaces a clean error to the user if the
  // service is truly offline (it may still be warming up, in which case the
  // job is accepted and queued anyway).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MODEL_SERVICE_BASE}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420"
        },
        body: JSON.stringify({
          prompt,
          enhanced_prompt: "",
          message_id: messageId,
          resolution: resolution ?? "2k",
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.task_id) return data.task_id as string;
      }
    } catch {
      /* retry */
    }
    await sleep(1000 * (attempt + 1));
  }
  return null;
}

/** Thrown for transient poll errors that should be retried. */
class TransientPollError extends Error {}

/** Streaming proxy URL for a finished video (served by /api/videos/stream/[messageId]). */
function streamUrlFor(messageId: string): string {
  return `/api/videos/stream/${messageId}`;
}

/** Poll the local service for task status. */
async function pollLocalTask(taskId: string, messageId: string): Promise<GenProgress> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    res = await fetch(`${MODEL_SERVICE_BASE}/status/${taskId}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
  } catch {
    throw new TransientPollError("model service unreachable");
  }

  if (res.status === 404) {
    return { status: "pending", progress: 0, lost: true };
  }
  if (!res.ok) {
    throw new TransientPollError(`status fetch failed (${res.status})`);
  }

  const data = await res.json();
  if (data.status === "ready" || data.status === "SUCCESS") {
    // The MP4 stays on the model service and is streamed through the
    // /api/videos/stream/[messageId] proxy. Unlike the old "download into
    // public/videos" approach, this URL works in dev AND in the standalone
    // production build (which serves a different public folder).
    return {
      status: "ready",
      progress: 100,
      videoUrl: streamUrlFor(messageId),
      source: "local",
      duration: data.duration,
      width: data.width,
      height: data.height,
    };
  }
  if (data.status === "failed" || data.status === "FAIL") {
    console.error(`[video-gen] task ${taskId} failed: ${data.error}`);
    return { status: "failed", progress: 0, errorMessage: FRIENDLY_FAILURE };
  }
  if (data.status === "queued") {
    return {
      status: "pending",
      progress: 0,
      phase: "queued",
      queuePosition: data.queue_position,
      queueLength: data.queue_length,
      etaSeconds: data.eta_seconds,
      source: "local",
    };
  }
  const pct = Math.min(99, Math.max(5, data.progress ?? 10));
  return {
    status: "generating",
    progress: pct,
    phase: pct >= 90 ? "finalizing" : "generating",
    etaSeconds: data.eta_seconds,
    source: "local",
  };
}

/**
 * Run the full generation pipeline for a message.
 * Calls onProgress with updates. Returns the final GenProgress.
 * Saves the Video record to the DB.
 */
export async function generateVideo(opts: {
  messageId: string;
  prompt: string;
  enhancedPrompt?: string;
  resolution?: string;
  onProgress?: (p: GenProgress) => void;
}): Promise<GenProgress> {
  const { messageId, prompt, resolution = "2k", onProgress } = opts;
  const deadline = Date.now() + JOB_TIMEOUT_MS;

  onProgress?.({ status: "pending", progress: 0, phase: "queued", source: "local" });

  let result: GenProgress = { status: "failed", progress: 0, errorMessage: FRIENDLY_FAILURE };

  for (let attempt = 0; attempt <= MAX_RESUBMITS; attempt++) {
    if (!(await waitForService(onProgress))) {
      result = {
        status: "failed",
        progress: 0,
        errorMessage: "The video model is offline right now. Please try again shortly.",
      };
      break;
    }

    const taskId = await submitLocalJob(prompt, messageId, resolution);
    if (!taskId) {
      result = { status: "failed", progress: 0, errorMessage: FRIENDLY_FAILURE };
      continue;
    }

    result = await pollUntilDone(() => pollLocalTask(taskId, messageId), onProgress, deadline);
    if (!result.lost) break;
    console.warn(`[video-gen] task ${taskId} lost (service restart) — resubmitting`);
    result = { status: "failed", progress: 0, errorMessage: FRIENDLY_FAILURE };
  }

  if (result.status === "ready") result.source = "local";
  delete result.lost;

  await persistVideo(messageId, result);
  return result;
}

/** Poll until terminal state; transient errors are retried, long outages => lost. */
async function pollUntilDone(
  poll: () => Promise<GenProgress>,
  onProgress: ((p: GenProgress) => void) | undefined,
  deadline: number,
): Promise<GenProgress> {
  const maxConsecutiveErrors = 24; // ~1 min unreachable => treat as lost
  let errors = 0;
  while (Date.now() < deadline) {
    try {
      const p = await poll();
      errors = 0;
      if (p.lost) return p;
      onProgress?.(p);
      if (p.status === "ready" || p.status === "failed") return p;
    } catch (err) {
      if (!(err instanceof TransientPollError)) throw err;
      errors++;
      console.warn(`[video-gen] transient poll error ${errors}/${maxConsecutiveErrors}: ${err.message}`);
      if (errors >= maxConsecutiveErrors) {
        return { status: "pending", progress: 0, lost: true };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    status: "failed",
    progress: 0,
    errorMessage: "This is taking longer than expected. Please try again.",
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Persist the final video record. */
async function persistVideo(messageId: string, result: GenProgress) {
  await db.video.updateMany({
    where: { messageId },
    data: {
      status: result.status,
      progress: result.progress,
      url: result.videoUrl ?? null,
      source: result.source ?? "local",
      errorMessage: result.errorMessage ?? null,
      // DB column is Int (seconds); the model returns fractional seconds.
      duration: result.duration != null ? Math.max(1, Math.round(result.duration)) : null,
      width: result.width ?? null,
      height: result.height ?? null,
      updatedAt: new Date(),
    },
  });
}
