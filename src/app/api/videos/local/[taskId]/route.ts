import { NextRequest, NextResponse } from "next/server";
import { MODEL_SERVICE_BASE } from "@/lib/constants";

type Params = { params: Promise<{ taskId: string }> };

// GET /api/videos/local/[taskId] → proxy to the Python model service video file.
// This is a fallback for serving locally-generated videos when download failed.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { taskId } = await params;
    // Sanitize taskId to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }
    const upstream = await fetch(`${MODEL_SERVICE_BASE}/video/${taskId}`, {
        headers: { "ngrok-skip-browser-warning": "69420" }
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Video not found on model service" },
        { status: 404 },
      );
    }
    const contentType =
      upstream.headers.get("content-type") || "video/mp4";
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("GET /api/videos/local/[taskId] error:", err);
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 500 });
  }
}
