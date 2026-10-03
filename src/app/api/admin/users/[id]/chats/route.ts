import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]/chats → all chats for a user (with message counts)
export async function GET(req: NextRequest, { params }: Params) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await params;
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const chats = await db.chat.findMany({
      where: { userId: id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { messages: true } },
        messages: {
          where: { role: "user" },
          orderBy: { createdAt: "asc" },
          select: { id: true, content: true, createdAt: true },
        },
      },
    });
    return NextResponse.json({ user, chats });
  } catch (err) {
    console.error("GET /api/admin/users/[id]/chats error:", err);
    return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
  }
}
