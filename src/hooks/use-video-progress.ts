"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { WS_URL } from "@/lib/constants";

export type GenPhase = "warming" | "queued" | "generating" | "finalizing";

export interface ProgressUpdate {
  messageId: string;
  chatId?: string;
  status: "pending" | "generating" | "ready" | "failed";
  progress: number;
  phase?: GenPhase;
  queuePosition?: number;
  queueLength?: number;
  etaSeconds?: number;
  videoUrl?: string;
  source?: string;
  errorMessage?: string;
}

/**
 * Subscribe to real-time progress updates for a specific message/video.
 * Also polls the REST endpoint every few seconds so the UI stays correct
 * (including queue position / ETA) even if the realtime service is down.
 */
export function useVideoProgress(
  messageId: string | null,
  opts?: {
    chatId?: string;
    onReady?: (url: string, source?: string) => void;
    onFailed?: (error?: string) => void;
    pollUrl?: string; // REST fallback e.g. /api/videos/123
    resetKey?: number; // change to force a fresh subscription
  },
) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<ProgressUpdate["status"]>("pending");
  const [phase, setPhase] = useState<GenPhase | undefined>("queued");
  const [queuePosition, setQueuePosition] = useState<number | undefined>();
  const [queueLength, setQueueLength] = useState<number | undefined>();
  const [etaSeconds, setEtaSeconds] = useState<number | undefined>();
  const [source, setSource] = useState<string | undefined>(undefined);
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null);
  const onReadyRef = useRef(opts?.onReady);
  const onFailedRef = useRef(opts?.onFailed);

  useEffect(() => {
    onReadyRef.current = opts?.onReady;
    onFailedRef.current = opts?.onFailed;
  });

  useEffect(() => {
    if (!messageId) return;

    let cancelled = false;
    let done = false;
    setStatus("pending");
    setPhase("queued");
    setProgress(0);
    setError(undefined);

    const apply = (u: {
      status: ProgressUpdate["status"];
      progress: number;
      phase?: GenPhase;
      queuePosition?: number;
      queueLength?: number;
      etaSeconds?: number;
      source?: string;
      url?: string;
      errorMessage?: string | null;
    }) => {
      if (cancelled || done) return;
      setProgress(u.progress ?? 0);
      setStatus(u.status);
      setPhase(u.phase);
      setQueuePosition(u.queuePosition);
      setQueueLength(u.queueLength);
      setEtaSeconds(u.etaSeconds);
      if (u.source) setSource(u.source);
      if (u.url) setVideoUrl(u.url);
      if (u.errorMessage) setError(u.errorMessage);
      if (u.status === "ready" && u.url) {
        done = true;
        onReadyRef.current?.(u.url, u.source);
      } else if (u.status === "failed") {
        done = true;
        onFailedRef.current?.(u.errorMessage ?? undefined);
      }
    };

    const sock = io(WS_URL, {
      path: "/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 8000,
    });
    socketRef.current = sock;

    sock.on("connect", () => {
      sock.emit("subscribe", { messageId, chatId: opts?.chatId });
    });

    sock.on("progress", (p: ProgressUpdate) => {
      if (p.messageId !== messageId) return;
      apply({ ...p, url: p.videoUrl });
    });

    // REST polling (every 3s) — the reliable path; carries queue info too.
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (opts?.pollUrl) {
      const poll = async () => {
        if (done) {
          if (pollTimer) clearInterval(pollTimer);
          return;
        }
        try {
          const res = await fetch(opts.pollUrl!, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (data.video) apply(data.video);
        } catch {
          /* ignore */
        }
      };
      pollTimer = setInterval(poll, 3000);
      poll();
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      sock.emit("unsubscribe", { messageId, chatId: opts?.chatId });
      sock.disconnect();
    };
  }, [messageId, opts?.resetKey]);

  return { progress, status, phase, queuePosition, queueLength, etaSeconds, source, videoUrl, error };
}
