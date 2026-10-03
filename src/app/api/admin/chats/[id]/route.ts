import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODEL_SERVICE_BASE } from "@/lib/constants";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = requireAdmin(req);
  if (auth) return auth;
  
  try {
    const { id } = await params;

    // First, find and cancel any ongoing generations for this chat
    const pendingVideos = await db.video.findMany({
      where: { 
        message: { chatId: id }, 
        status: { in: ["pending", "generating", "queued"] } 
      }
    });
    
    for (const v of pendingVideos) {
      try {
        await fetch(`${MODEL_SERVICE_BASE}/cancel/${v.messageId}`, { 
          method: 'DELETE',
          headers: { "ngrok-skip-browser-warning": "69420" }
        });
      } catch (e) {}
    }

    await db.chat.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}
