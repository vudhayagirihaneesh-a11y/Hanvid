import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/users → all users with chat/message counts
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const users = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { chats: true },
        },
        chats: {
          select: {
            id: true,
            _count: { select: { messages: true } },
          },
        },
      },
    });

    const enriched = users.map((u) => {
      const messageCount = u.chats.reduce(
        (sum, c) => sum + c._count.messages,
        0,
      );
      const chatCount = u._count.chats;
      return {
        id: u.id,
        name: u.name,
        createdAt: u.createdAt,
        chatCount,
        messageCount,
      };
    });

    return NextResponse.json({ users: enriched });
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
