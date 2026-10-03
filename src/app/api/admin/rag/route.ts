import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/rag → list all RAG documents
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const docs = await db.ragDocument.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ docs });
  } catch (err) {
    console.error("GET /api/admin/rag error:", err);
    return NextResponse.json({ error: "Failed to fetch RAG docs" }, { status: 500 });
  }
}

// POST /api/admin/rag { title, content, tags } → create a RAG document
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const { title, content, tags } = await req.json();
    if (!title || !content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 },
      );
    }
    const doc = await db.ragDocument.create({
      data: {
        title: String(title).slice(0, 200),
        content: String(content).slice(0, 20000),
        tags: String(tags ?? "").slice(0, 500),
      },
    });
    return NextResponse.json({ doc }, { status: 201 });
  } catch (err) {
    console.error("POST /api/admin/rag error:", err);
    return NextResponse.json({ error: "Failed to create RAG doc" }, { status: 500 });
  }
}

// DELETE /api/admin/rag (with ?id=X) → delete a doc
export async function DELETE(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await db.ragDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/rag error:", err);
    return NextResponse.json({ error: "Failed to delete RAG doc" }, { status: 500 });
  }
}
