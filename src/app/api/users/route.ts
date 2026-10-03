import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/users  { name } → creates (or returns existing) user
export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const trimmed = name.trim().slice(0, 60);
    const user = await db.user.create({
      data: { name: trimmed },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    console.error("POST /api/users error:", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

// GET /api/users?name=X → lookup by name (for returning users)
// GET /api/users?id=X  → lookup by id (with chats)
export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name");
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const user = await db.user.findUnique({
        where: { id },
        include: { chats: { orderBy: { updatedAt: "desc" } } },
      });
      if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ user });
    }
    if (name) {
      const user = await db.user.findFirst({
        where: { name: { equals: name } },
        include: { chats: { orderBy: { updatedAt: "desc" } } },
      });
      if (!user) return NextResponse.json({ user: null });
      return NextResponse.json({ user });
    }
    return NextResponse.json({ error: "Provide name or id param" }, { status: 400 });
  } catch (err) {
    console.error("GET /api/users error:", err);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
