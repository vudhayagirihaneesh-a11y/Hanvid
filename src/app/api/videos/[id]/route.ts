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
    if (video.status === "ready" || video.status === "failed") {
        return NextResponse.json({ video });
    }

    try {
        const pyRes = await fetch(`${MODEL_SERVICE_BASE}/status/by_message/${video.messageId}`, { cache: "no-store" });
        if (pyRes.ok) {
            const pyData = await pyRes.json();
            const merged = {
                ...video,
                status: pyData.status,
                progress: pyData.progress,
                phase: pyData.status === "generating" && pyData.progress >= 90 ? "finalizing" : (pyData.status === "queued" ? "queued" : "generating"),
                queuePosition: pyData.queue_position,
                queueLength: pyData.queue_length,
                etaSeconds: pyData.eta_seconds,
            };
            
            if (pyData.status === "ready") {
                const parts = pyData.video_url.split("/");
                const taskId = parts[parts.length - 1];
                merged.url = `/api/videos/local/${taskId}`;
                merged.width = pyData.width;
                merged.height = pyData.height;
                merged.duration = pyData.duration ? Math.max(1, Math.round(pyData.duration)) : null;
                await db.video.update({ where: { id: video.id }, data: { status: "ready", progress: 100, url: merged.url, width: merged.width, height: merged.height, duration: merged.duration }});
                await db.message.update({ where: { id: video.messageId }, data: { content: "Video generated." }});
            } else if (pyData.status === "failed") {
                merged.errorMessage = pyData.error || "Generation failed";
                await db.video.update({ where: { id: video.id }, data: { status: "failed", errorMessage: merged.errorMessage }});
                await db.message.update({ where: { id: video.messageId }, data: { content: "Generation failed: " + merged.errorMessage }});
            } else {
                // Throttle db updates for progress? Optional, but Vercel lambda handles this, so updating DB might be fine, or we can just leave DB as pending and serve from merged.
                // It's better to just let merged pass to client. The client will poll again.
            }
            return NextResponse.json({ video: merged });
        }
    } catch(e) {}
    
    return NextResponse.json({ video });
  } catch (err) {
    console.error("GET /api/videos/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 500 });
  }
}
