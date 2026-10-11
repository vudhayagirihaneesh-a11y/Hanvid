import { NextRequest, NextResponse } from "next/server";
import { MODEL_SERVICE_BASE } from "@/lib/constants";

type Params = { params: Promise<{ messageId: string }> };

export const runtime = "nodejs";

// GET /api/videos/stream/[messageId] → stream the video for a message directly from the model service.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { messageId } = await params;
    if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) {
      return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
    }

    const headers: Record<string, string> = {
      "ngrok-skip-browser-warning": "69420",
    };
    const range = req.headers.get("range");
    if (range) {
      headers["range"] = range;
    }

    let upstream = await fetch(`${MODEL_SERVICE_BASE}/video/by_message/${messageId}`, {
      headers,
      cache: "no-store",
    });

    if (!upstream.ok) {
      // Fallback: check known mapping or database
      const FALLBACK_MAP: Record<string, string> = {
        "cmv3wq4cy000rupto8hqoex4n": "5e5df3006e1c455b",
        "cmv3vj5m9000lupto5zwpi7c4": "10a5c105aa214be8",
        "cmv3qpfj00009uptois1mouig": "25c93b5e42e8432c",
        "cmv3nq0ro0003uptonnebbcf3": "cf7839feef6c4214",
        "cmv3cbxxh000iup9oib3bcy6s": "789626ea55a545e2",
        "cmv3rssim000fuptonqtwxon9": "2a0a18da874d4bf1",
      };

      let fallbackTaskId = FALLBACK_MAP[messageId];

      if (!fallbackTaskId) {
        try {
          const { db } = await import("@/lib/db");
          const v = await db.video.findUnique({ where: { messageId } });
          if (v?.url) {
            const m = v.url.match(/local\/([a-zA-Z0-9_-]+)/);
            if (m) fallbackTaskId = m[1];
          }
        } catch {
          /* ignore DB lookup error */
        }
      }

      if (!fallbackTaskId && /^[a-f0-9]{16}$/i.test(messageId)) {
        fallbackTaskId = messageId;
      }

      if (fallbackTaskId) {
        upstream = await fetch(`${MODEL_SERVICE_BASE}/video/${fallbackTaskId}`, {
          headers,
          cache: "no-store",
        });
      }
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Video not found on model service" },
        { status: upstream.status }
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
    console.error("GET /api/videos/stream/[messageId] error:", err);
    return NextResponse.json({ error: "Failed to stream video" }, { status: 500 });
  }
}
