import { db } from "@/lib/db";
import { generateVideo, GenProgress } from "@/lib/video-gen";
import { pushProgress } from "@/lib/realtime";
import { setLiveStatus } from "@/lib/live-status";

// Fire-and-forget generation. Uses a global tracker so the promise survives
// the request lifecycle in dev mode.
const globalForGen = globalThis as unknown as {
  __wanvidGen: Set<Promise<void>>;
};
if (!globalForGen.__wanvidGen) globalForGen.__wanvidGen = new Set();

const DB_PROGRESS_THROTTLE_MS = 3000;

export function runGenerationInBackground(opts: {
  messageId: string;
  videoId: string;
  chatId: string;
  prompt: string;
}) {
  let lastDbWrite = 0;
  let lastDbKey = "";

  const publish = (p: GenProgress) => {
    setLiveStatus(opts.messageId, {
      status: p.status,
      progress: p.progress,
      phase: p.phase,
      queuePosition: p.queuePosition,
      queueLength: p.queueLength,
      etaSeconds: p.etaSeconds,
    });
    pushProgress({
      messageId: opts.messageId,
      chatId: opts.chatId,
      status: p.status,
      progress: p.progress,
      phase: p.phase,
      queuePosition: p.queuePosition,
      queueLength: p.queueLength,
      etaSeconds: p.etaSeconds,
      videoUrl: p.videoUrl,
      source: p.source,
      errorMessage: p.errorMessage,
    });

    // Keep the DB roughly in sync (survives a Next.js restart) but throttled.
    if (p.status === "ready" || p.status === "failed") return; // persistVideo handles it
    const key = `${p.status}:${p.phase}`;
    const now = Date.now();
    if (key !== lastDbKey || now - lastDbWrite > DB_PROGRESS_THROTTLE_MS) {
      lastDbKey = key;
      lastDbWrite = now;
      db.video
        .update({ where: { id: opts.videoId }, data: { status: p.status, progress: p.progress } })
        .catch(() => {});
    }
  };

  const task = (async () => {
    try {
      const result = await generateVideo({
        messageId: opts.messageId,
        prompt: opts.prompt,
        onProgress: publish,
      });

      await db.message.update({
        where: { id: opts.messageId },
        data: {
          content:
            result.status === "ready"
              ? "Video generated."
              : `Generation failed: ${result.errorMessage ?? "unknown error"}`,
        },
      });

      publish(result);
    } catch (err) {
      console.error("Generation error:", err);
      const failed: GenProgress = {
        status: "failed",
        progress: 0,
        errorMessage: "Something went wrong on our side. Please try again.",
      };
      await db.video
        .update({
          where: { id: opts.videoId },
          data: { status: "failed", errorMessage: failed.errorMessage },
        })
        .catch(() => {});
      publish(failed);
    }
  })();

  globalForGen.__wanvidGen.add(task);
  task.finally(() => globalForGen.__wanvidGen.delete(task));
  return task;
}
