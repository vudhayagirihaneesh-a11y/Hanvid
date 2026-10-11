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
  Square,
} from "lucide-react";
import { toast } from "sonner";

const SOURCE_LABEL: Record<string, string> = {
  local: "Local Generation",
  auto: "Auto Generation",
};

export function getResolutionBadge(width?: number | null, height?: number | null) {
  if (!width && !height) return null;
  const w = width ?? 0;
  const h = height ?? 0;
  if (w >= 3800 || h >= 2100) return { label: "4K UHD", className: "bg-purple-500/15 text-purple-300 border-purple-500/30" };
  if (w >= 2500 || h >= 1400) return { label: "2K QHD", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" };
  if (w >= 1900 || h >= 1000) return { label: "1080p FHD", className: "bg-blue-500/15 text-blue-300 border-blue-500/30" };
  return { label: `${w}×${h}`, className: "bg-muted text-muted-foreground border-border/40" };
}

export function formatEta(sec?: number): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
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

  const terminal = video?.status === "ready" || video?.status === "failed";
  const live = useVideoProgress(terminal ? null : message?.id, {
    chatId,
    pollUrl: video?.id && !video.id.startsWith("tmp-") ? `/api/videos/${video.id}` : undefined,
    resetKey: subKey,
  });

  const finalStatus = terminal ? video?.status : live.status;
  const finalUrl = video?.url || live.videoUrl;
  const finalProgress = video?.status === "ready" ? 100 : live.progress;
  const finalSource = live.source || video?.source;
  const finalError = (terminal ? video?.errorMessage : live.error) || live.error;
  const phase = live.phase;

  const isWorking = finalStatus === "generating" || finalStatus === "pending" || finalStatus === "queued";

  const retry = async () => {
    if (!video || video.id.startsWith("tmp-")) return;
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
    if (!video || video.id.startsWith("tmp-")) return;
    try {
      await api.cancelVideo(video.id);
      setVideo((v) => (v ? { ...v, status: "failed", errorMessage: "Cancelled by user" } : v));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel");
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl overflow-hidden border border-border bg-card/60 backdrop-blur">
        {/* Video / Preview area */}
        <div className="relative aspect-video bg-black/60 flex items-center justify-center overflow-hidden">
          {finalStatus === "ready" && finalUrl ? (
            <video
              src={finalUrl}
              controls
              autoPlay
              loop
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
                id={`retry-${video?.id || "unknown"}`}
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
        <div className="p-2.5 sm:p-3 flex items-center justify-between gap-2 border-t border-border/60 bg-card/40">
          <div className="flex items-center gap-2 min-w-0">
            {finalSource && (
              <Badge
                variant="secondary"
                className={
                  finalStatus === "ready"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0 text-[11px]"
                    : "text-muted-foreground shrink-0 text-[11px]"
                }
              >
                <Sparkles className="w-3 h-3 mr-1" />
                {SOURCE_LABEL[finalSource] ?? finalSource}
              </Badge>
            )}
            {finalStatus === "ready" && (() => {
              const resBadge = getResolutionBadge(video?.width, video?.height);
              return resBadge ? (
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${resBadge.className}`}
                >
                  {resBadge.label}
                </Badge>
              ) : null;
            })()}
            {message?.enhancedPrompt && (
              <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                <Wand2 className="w-3 h-3 shrink-0" /> Knowledge applied
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isWorking && (
              <Button
                size="sm"
                variant="ghost"
                onClick={cancel}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Stop generating"
              >
                <Square className="w-3 h-3 fill-current mr-1" />
                Stop
              </Button>
            )}
            {finalStatus === "ready" && finalUrl && (
              <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0 sm:h-8 sm:w-8 shrink-0">
                <a href={finalUrl} download title="Download video">
                  <Download className="w-3.5 h-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {message?.enhancedPrompt && (
        <details className="mt-2 group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
            View prompt sent to the model
          </summary>
          <RagPromptView raw={message.enhancedPrompt} />
        </details>
      )}
    </div>
  );
}

/** Pretty-print the RAG protocol payload (or a plain prompt) for the UI. */
function RagPromptView({ raw }: { raw: string }) {
  let userPrompt = raw;
  let rules = "";
  if (raw.includes("---RAG_START---")) {
    const mUser = raw.match(/USER_PROMPT:\n?([\s\S]*?)(\n\s*RAG_RULES:|\n\s*---RAG_END---|$)/);
    const mRules = raw.match(/RAG_RULES:\n?([\s\S]*?)(\n\s*RAG_INSTRUCTION:|\n\s*---RAG_END---|$)/);
    if (mUser) userPrompt = mUser[1].trim();
    if (mRules) rules = mRules[1].trim();
  }

  const docs = rules
    .split(/\n(?=\[)/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="mt-2 text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-3 border border-border/40 leading-relaxed space-y-2">
      <p className="whitespace-pre-wrap">{userPrompt}</p>
      {docs.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
            Knowledge applied
          </p>
          {docs.map((d, i) => {
            const m = d.match(/^\[([^\]]+)\]\n?([\s\S]*)$/);
            return (
              <div key={i} className="pl-2 border-l-2 border-emerald-500/30">
                <p className="font-medium text-emerald-300/80">{m ? m[1] : "Reference"}</p>
                <p className="whitespace-pre-wrap">{m ? m[2].trim() : d}</p>
              </div>
            );
          })}
        </div>
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
    "absolute inset-0 flex flex-col items-center justify-center gap-2 sm:gap-2.5 text-center px-4 py-3 bg-gradient-to-br overflow-hidden select-none";

  if (phase === "warming") {
    return (
      <div className={`${shell} from-sky-950/40 via-black/40 to-black/60`}>
        <div className="relative">
          <Flame className="w-8 h-8 text-sky-300 animate-pulse" />
          <div className="absolute inset-0 blur-lg bg-sky-500/25 animate-pulse-glow" />
        </div>
        <div className="space-y-0.5 max-w-xs">
          <p className="text-xs sm:text-sm text-sky-200 font-medium">Warming up the studio…</p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            The video model is loading. You&apos;re saved in line.
          </p>
        </div>
        <div className="w-1/2 h-1 rounded-full bg-sky-500/15 overflow-hidden">
          <div className="h-full w-1/3 bg-sky-400/60 rounded-full animate-waitlist-slide" />
        </div>
      </div>
    );
  }

  if (phase === "queued" || (status === "pending" && !phase)) {
    const pos = queuePosition ?? 1;
    const ahead = Math.max(0, pos - 1);
    return (
      <div className={`${shell} from-violet-950/40 via-black/40 to-black/60`}>
        <div className="relative w-11 h-11 rounded-xl border border-violet-400/20 bg-violet-500/10 flex items-center justify-center">
          <span className="text-lg font-bold text-violet-200 tabular-nums">
            {queuePosition ? `#${pos}` : <Users className="w-5 h-5 text-violet-300" />}
          </span>
          <div className="absolute inset-0 rounded-xl blur-lg bg-violet-500/20 animate-pulse-glow" />
        </div>
        <div className="space-y-0.5 max-w-xs">
          <p className="text-xs sm:text-sm text-violet-100 font-medium">
            {queuePosition ? `You're ${ordinal(pos)} in line` : "Joining the waitlist…"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {queuePosition
              ? ahead === 0
                ? "You're next — starting as soon as current video finishes."
                : `${ahead} video${ahead === 1 ? "" : "s"} ahead${queueLength ? ` · ${queueLength} waiting` : ""}`
              : "Reserving your spot in line…"}
          </p>
        </div>
        {etaSeconds != null && (
          <div className="flex items-center gap-1 text-[11px] text-violet-200/80 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-0.5">
            <Clock className="w-3 h-3" />
            Ready in {formatEta(etaSeconds)}
          </div>
        )}
        <div className="w-1/2 h-1 rounded-full bg-violet-500/15 overflow-hidden">
          <div className="h-full w-1/3 bg-violet-400/60 rounded-full animate-waitlist-slide" />
        </div>
      </div>
    );
  }

  const finalizing = phase === "finalizing";
  return (
    <div className={`${shell} from-emerald-950/40 via-black/40 to-black/60`}>
      <div className="relative">
        <Film className="w-8 h-8 text-emerald-400 animate-pulse" />
        <div className="absolute inset-0 blur-lg bg-emerald-500/25 animate-pulse-glow" />
      </div>
      <div className="space-y-0.5">
        <p className="text-xs sm:text-sm text-emerald-300/90 font-medium">
          {finalizing ? "Rendering final frames…" : "Generating your video…"}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {progress}%{etaSeconds != null && !finalizing ? ` · ${formatEta(etaSeconds)} left` : ""}
        </p>
      </div>
      <div className="w-2/3 max-w-[260px]">
        <Progress value={progress} className="h-1.5" />
      </div>
      <p className="text-[10px] text-emerald-200/60 italic max-w-[85%] truncate sm:whitespace-normal">
        &quot;Sit back and relax. Stable generation takes a little time.&quot;
      </p>
    </div>
  );
}

