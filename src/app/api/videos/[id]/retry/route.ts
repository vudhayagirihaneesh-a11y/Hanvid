import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runGenerationInBackground } from "@/lib/generation-runner";
import { setLiveStatus } from "@/lib/live-status";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/videos/[id]/retry → re-queue a failed video with its original prompt.
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: { message: true },
    });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    if (video.status !== "failed") {
      return NextResponse.json({ error: "Only failed videos can be retried" }, { status: 409 });
    }

    // The prompt is the user message immediately preceding this assistant message.
    const userMsg = await db.message.findFirst({
      where: {
        chatId: video.message.chatId,
        role: "user",
        createdAt: { lte: video.message.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!userMsg) {
      return NextResponse.json({ error: "Original prompt not found" }, { status: 404 });
    }

    const updated = await db.video.update({
      where: { id },
      data: { status: "pending", progress: 0, errorMessage: null, url: null },
    });
    await db.message.update({
      where: { id: video.messageId },
      data: { content: "Generating video…" },
    });
    setLiveStatus(video.messageId, { status: "pending", progress: 0, phase: "queued" });

    runGenerationInBackground({
      messageId: video.messageId,
      videoId: id,
      chatId: video.message.chatId,
      prompt: userMsg.content,
    }).catch((err) => console.error("Retry generation failed:", err));

    return NextResponse.json({ video: updated });
  } catch (err) {
    console.error("POST /api/videos/[id]/retry error:", err);
    return NextResponse.json({ error: "Failed to retry" }, { status: 500 });
  }
}
