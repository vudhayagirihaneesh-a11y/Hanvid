import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/chats/[id]/messages → messages for a chat
// NOTE: Returns prompts/text only. Video URLs are intentionally NOT included
// so the admin can monitor what users are asking without viewing the videos.
export async function GET(req: NextRequest, { params }: Params) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await params;
    const chat = await db.chat.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const messages = await db.message.findMany({
      where: { chatId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        enhancedPrompt: true,
        createdAt: true,
        video: {
          select: {
            id: true,
            status: true,
            progress: true,
            source: true,
            errorMessage: true,
            createdAt: true,
            // NOTE: `url` deliberately omitted — admin sees prompts & status, not the video itself.
          },
        },
      },
    });
    return NextResponse.json({ chat, messages });
  } catch (err) {
    console.error("GET /api/admin/chats/[id]/messages error:", err);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
