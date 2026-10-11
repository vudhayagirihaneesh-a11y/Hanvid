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
    const headers: Record<string, string> = {
      "ngrok-skip-browser-warning": "69420",
    };
    const range = req.headers.get("range");
    if (range) {
      headers["range"] = range;
    }

    const upstream = await fetch(`${MODEL_SERVICE_BASE}/video/${taskId}`, {
      headers,
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Video not found on model service" },
        { status: upstream.status },
      );
    }
    const resHeaders = new Headers();
    const forwardHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-disposition",
    ];
    for (const header of forwardHeaders) {
      const val = upstream.headers.get(header);
      if (val) resHeaders.set(header, val);
    }
    resHeaders.set("Cache-Control", "public, max-age=3600");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err) {
    console.error("GET /api/videos/local/[taskId] error:", err);
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 500 });
  }
}
