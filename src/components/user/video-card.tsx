"use client";

import { useState } from "react";
import { api, Video } from "@/lib/api-client";
import { useVideoProgress } from "@/hooks/use-video-progress";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download,
  Play,
  Film,
  Sparkles,
  Users,
  Clock,
  Flame,
  RotateCcw,
  CloudOff,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

const SOURCE_LABEL: Record<string, string> = {
  local: "Local Generation",
  auto: "Auto Generation",
};

export function formatEta(sec?: number): string {
  if (sec == null || !isFinite(sec)) return "";
  if (sec < 60) return `~${Math.max(5, Math.round(sec / 5) * 5)}s`;
  const m = Math.round(sec / 60);
  return `~${m} min`;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function VideoCard({
  video: initialVideo,
  message,
  chatId,
}: {
  video: Video;
  message: { id: string; content: string; enhancedPrompt?: string | null };
  chatId: string;
}) {
  // Local copy so "Try again" can reset the card without a page reload.
  const [video, setVideo] = useState(initialVideo);
  const [retrying, setRetrying] = useState(false);
  const [subKey, setSubKey] = useState(0);

  const terminal = video.status === "ready" || video.status === "failed";
  const live = useVideoProgress(terminal ? null : message.id, {
    chatId,
    pollUrl: video.id && !video.id.startsWith("tmp-") ? `/api/videos/${video.id}` : undefined,
    resetKey: subKey,
  });

  const finalStatus = terminal ? video.status : live.status;
  const finalUrl = video.url || live.videoUrl;
  const finalProgress = video.status === "ready" ? 100 : live.progress;
  const finalSource = live.source || video.source;
  const finalError = (terminal ? video.errorMessage : live.error) || live.error;
  const phase = live.phase;

  const isWorking = finalStatus === "generating" || finalStatus === "pending" || finalStatus === "queued";

  const retry = async () => {
    if (video.id.startsWith("tmp-")) return;
    setRetrying(true);
    try {
      const { video: v } = await api.retryVideo(video.id);
      setVideo({ ...v, status: "pending", progress: 0, errorMessage: null, url: null });
      setSubKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't retry");
    } finally {
      setRetrying(false);
    }
  };

  const cancel = async () => {
    if (video.id.startsWith("tmp-")) return;
    try {
      await api.cancelVideo(video.id);
      setVideo((v) => ({ ...v, status: "failed", errorMessage: "Cancelled by user" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel");
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl overflow-hidden border border-border bg-card/60 backdrop-blur">
        {/* Video / Preview area */}
        <div className="relative aspect-video bg-black/60 flex items-center justify-center">
          {finalStatus === "ready" && finalUrl ? (
            <video
              src={finalUrl}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : isWorking ? (
            <WorkingState
              phase={phase}
              status={finalStatus}
              progress={finalProgress}
              queuePosition={live.queuePosition}
              queueLength={live.queueLength}
              etaSeconds={live.etaSeconds}
              onCancel={cancel}
            />
          ) : finalStatus === "failed" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6 bg-gradient-to-br from-amber-950/30 via-black/40 to-black/60">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <CloudOff className="w-6 h-6 text-amber-300" />
              </div>
              <div>
                <p className="text-sm text-amber-200 font-medium">Couldn&apos;t finish this one</p>
                <p className="text-xs text-muted-foreground max-w-xs mt-1">
                  {finalError || "Something went wrong. Please try again."}
                </p>
              </div>
              <Button
                id={`retry-${video.id}`}
                size="sm"
                variant="secondary"
                className="gap-2 mt-1"
                onClick={retry}
                disabled={retrying}
              >
                <RotateCcw className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} />
                {retrying ? "Rejoining queue…" : "Try again"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <Play className="w-10 h-10 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 flex items-center justify-between gap-2 border-t border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            {finalSource && (
              <Badge
                variant="secondary"
                className={
                  finalStatus === "ready"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0"
                    : "text-muted-foreground shrink-0"
                }
              >
                <Sparkles className="w-3 h-3 mr-1" />
                {SOURCE_LABEL[finalSource] ?? finalSource}
              </Badge>
            )}
            {message.enhancedPrompt && (
              <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                <Wand2 className="w-3 h-3" /> Knowledge applied
              </span>
            )}
          </div>
          {finalStatus === "ready" && finalUrl && (
            <Button asChild size="sm" variant="ghost" className="h-8 shrink-0">
              <a href={finalUrl} download>
                <Download className="w-3.5 h-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {message.enhancedPrompt && (
        <details className="mt-2 group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
            View prompt sent to the model
          </summary>
          <p className="mt-2 text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-3 border border-border/40 leading-relaxed">
            {message.enhancedPrompt}
          </p>
        </details>
      )}
    </div>
  );
}

function WorkingState({
  phase,
  status,
  progress,
  queuePosition,
  queueLength,
  etaSeconds,
}: {
  phase?: string;
  status: string;
  progress: number;
  queuePosition?: number;
  queueLength?: number;
  etaSeconds?: number;
  onCancel?: () => void;
}) {
  const shell =
    "absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 bg-gradient-to-br";

  if (phase === "warming") {
    return (
      <div className={`${shell} from-sky-950/40 via-black/40 to-black/60`}>
        <div className="relative">
          <Flame className="w-11 h-11 text-sky-300 animate-pulse" />
          <div className="absolute inset-0 blur-xl bg-sky-500/30 animate-pulse-glow" />
        </div>
        <p className="text-sm text-sky-200 font-medium">Warming up the studio…</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          The video model is loading. You&apos;re saved in line — this page will update by itself.
        </p>
        <div className="w-2/3 h-1 rounded-full bg-sky-500/10 overflow-hidden">
          <div className="h-full w-1/3 bg-sky-400/60 rounded-full animate-waitlist-slide" />
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="mt-2 text-xs h-7 text-sky-200/60 hover:text-sky-200 hover:bg-sky-900/40">
            Stop generating
          </Button>
        )}
      </div>
    );
  }

  if (phase === "queued" || (status === "pending" && !phase)) {
    const pos = queuePosition ?? 1;
    const ahead = Math.max(0, pos - 1);
    return (
      <div className={`${shell} from-violet-950/40 via-black/40 to-black/60`}>
        <div className="relative w-16 h-16 rounded-2xl border border-violet-400/20 bg-violet-500/10 flex items-center justify-center">
          <span className="text-2xl font-bold text-violet-200 tabular-nums">
            {queuePosition ? `#${pos}` : <Users className="w-7 h-7 text-violet-300" />}
          </span>
          <div className="absolute inset-0 rounded-2xl blur-xl bg-violet-500/20 animate-pulse-glow" />
        </div>
        <div>
          <p className="text-sm text-violet-100 font-medium">
            {queuePosition ? `You're ${ordinal(pos)} in line` : "Joining the waitlist…"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {queuePosition
              ? ahead === 0
                ? "You're next — starting as soon as the current video finishes."
                : `${ahead} video${ahead === 1 ? "" : "s"} ahead of you${queueLength ? ` · ${queueLength} waiting` : ""}`
              : "Hang tight, we're reserving your spot."}
          </p>
        </div>
        {etaSeconds != null && (
          <div className="flex items-center gap-1.5 text-xs text-violet-200/80 bg-violet-500/10 border border-violet-500/20 rounded-full px-3 py-1">
            <Clock className="w-3 h-3" />
            Ready in {formatEta(etaSeconds)}
          </div>
        )}
        <div className="w-2/3 h-1 rounded-full bg-violet-500/10 overflow-hidden">
          <div className="h-full w-1/3 bg-violet-400/60 rounded-full animate-waitlist-slide" />
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="mt-2 text-xs h-7 text-violet-200/60 hover:text-violet-200 hover:bg-violet-900/40">
            Stop generating
          </Button>
        )}
      </div>
    );
  }

  const finalizing = phase === "finalizing";
  return (
    <div className={`${shell} from-emerald-950/40 via-black/40 to-black/60`}>
      <div className="relative">
        <Film className="w-12 h-12 text-emerald-400 animate-pulse" />
        <div className="absolute inset-0 blur-xl bg-emerald-500/30 animate-pulse-glow" />
      </div>
      <p className="text-sm text-emerald-300/90 font-medium">
        {finalizing ? "Rendering final frames…" : "Generating your video…"}
      </p>
      <div className="w-3/4">
        <Progress value={progress} className="h-1.5" />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {progress}%{etaSeconds != null && !finalizing ? ` · ${formatEta(etaSeconds)} left` : ""}
      </p>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel} className="mt-2 text-xs h-7 text-emerald-200/60 hover:text-emerald-200 hover:bg-emerald-900/40">
          Stop generating
        </Button>
      )}
    </div>
  );
}
