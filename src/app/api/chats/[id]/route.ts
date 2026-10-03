import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODEL_SERVICE_BASE } from "@/lib/constants";

type Params = { params: Promise<{ id: string }> };

// GET /api/chats/[id] → chat with messages and video info
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const chat = await db.chat.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { video: true },
        },
        user: true,
      },
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    return NextResponse.json({ chat });
  } catch (err) {
    console.error("GET /api/chats/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch chat" }, { status: 500 });
  }
}

// DELETE /api/chats/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    
    // Cancel ongoing videos (best-effort, never block the delete)
    const pendingVideos = await db.video.findMany({
      where: { 
        message: { chatId: id }, 
        status: { in: ["pending", "generating", "queued"] } 
      }
    });
    
    await Promise.allSettled(
      pendingVideos.map((v) =>
        fetch(`${MODEL_SERVICE_BASE}/cancel/${v.messageId}`, {
          method: 'DELETE',
          headers: { "ngrok-skip-browser-warning": "69420" },
          signal: AbortSignal.timeout(3000),
        })
      )
    );

    await db.chat.deleteMany({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/chats/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}

// PATCH /api/chats/[id] { title } → rename chat
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { title } = await req.json();
    const chat = await db.chat.update({
      where: { id },
      data: { title: String(title).slice(0, 100) },
    });
    return NextResponse.json({ chat });
  } catch (err) {
    console.error("PATCH /api/chats/[id] error:", err);
    return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
  }
}
