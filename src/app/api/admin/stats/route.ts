import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/stats → aggregate counts
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const [userCount, chatCount, messageCount, videoCount, ragCount, readyVideos] =
      await Promise.all([
        db.user.count(),
        db.chat.count(),
        db.message.count(),
        db.video.count(),
        db.ragDocument.count(),
        db.video.count({ where: { status: "ready" } }),
      ]);

    const usersByDay = await db.user.groupBy({
      by: ["createdAt"],
      _count: true,
    });

    return NextResponse.json({
      userCount,
      chatCount,
      messageCount,
      videoCount,
      readyVideos,
      ragCount,
    });
  } catch (err) {
    console.error("GET /api/admin/stats error:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
