import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLiveStatus } from "@/lib/live-status";

type Params = { params: Promise<{ id: string }> };

// GET /api/videos/[id] → current video status (for polling fallback).
// Merges in-memory live status (queue position, ETA, phase, fresh progress)
// for in-flight jobs so the UI is accurate without the realtime service.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: { message: { select: { chatId: true, enhancedPrompt: true } } },
    });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    const live =
      video.status === "ready" || video.status === "failed"
        ? undefined
        : getLiveStatus(video.messageId);
    const merged = live
      ? {
          ...video,
          status: live.status === "ready" || live.status === "failed" ? video.status : live.status,
          progress: Math.max(video.progress, live.progress),
          phase: live.phase,
          queuePosition: live.queuePosition,
          queueLength: live.queueLength,
          etaSeconds: live.etaSeconds,
        }
      : video;
    return NextResponse.json({ video: merged });
  } catch (err) {
    console.error("GET /api/videos/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 500 });
  }
}
