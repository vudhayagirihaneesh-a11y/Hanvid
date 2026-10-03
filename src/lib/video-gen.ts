import { db } from "@/lib/db";
import { MODEL_SERVICE_BASE } from "@/lib/constants";
import type { GenPhase } from "@/lib/live-status";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Video generation orchestration.
 *
 * Strategy:
 * 1. Wait (patiently) for the local Python Wan2.1 service to be up and the
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

/** Check whether the local Python model service is available and loaded. */
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
      modelLoaded: data.model_loaded === true,
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
export async function submitLocalJob(prompt: string, messageId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${MODEL_SERVICE_BASE}/generate`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420"
        },
        body: JSON.stringify({ prompt, enhanced_prompt: "", message_id: messageId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.task_id) return data.task_id as string;
      }
    } catch {
      /* retry */
    }
    await sleep(2000 * (attempt + 1));
  }
  return null;
}

/** Thrown for transient poll errors that should be retried. */
class TransientPollError extends Error {}

/** Poll the local service for task status. */
async function pollLocalTask(taskId: string): Promise<GenProgress> {
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
    // Download the video from the Python service to local public storage so it
    // is served uniformly by Next.js (browsers can't reach port 3004 directly).
    const localUrl = await downloadLocalVideo(taskId);
    if (!localUrl) {
      throw new TransientPollError("video download failed");
    }
    return {
      status: "ready",
      progress: 100,
      videoUrl: localUrl,
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
  onProgress?: (p: GenProgress) => void;
}): Promise<GenProgress> {
  const { messageId, prompt, onProgress } = opts;
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

    const taskId = await submitLocalJob(prompt, messageId);
    if (!taskId) {
      result = { status: "failed", progress: 0, errorMessage: FRIENDLY_FAILURE };
      continue;
    }

    result = await pollUntilDone(() => pollLocalTask(taskId), onProgress, deadline);
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

/** Download a video generated by the local Python service into public storage. */
async function downloadLocalVideo(taskId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MODEL_SERVICE_BASE}/video/${taskId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = join(process.cwd(), "public", "videos");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `local-${taskId}.mp4`;
    writeFileSync(join(dir, filename), buf);
    return `/videos/${filename}`;
  } catch (err) {
    console.error("Failed to download local video:", err);
    return null;
  }
}
