import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

// PUT /api/admin/rag/[id] { title, content, tags } → update a RAG document
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await params;
    const { title, content, tags } = await req.json();
    const doc = await db.ragDocument.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: String(title).slice(0, 200) } : {}),
        ...(content !== undefined
          ? { content: String(content).slice(0, 20000) }
          : {}),
        ...(tags !== undefined ? { tags: String(tags).slice(0, 500) } : {}),
      },
    });
    return NextResponse.json({ doc });
  } catch (err) {
    console.error("PUT /api/admin/rag/[id] error:", err);
    return NextResponse.json({ error: "Failed to update RAG doc" }, { status: 500 });
  }
}

// DELETE /api/admin/rag/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await params;
    await db.ragDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/rag/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete RAG doc" }, { status: 500 });
  }
}
