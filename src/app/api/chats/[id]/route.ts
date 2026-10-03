import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
    await db.chat.delete({ where: { id } });
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
