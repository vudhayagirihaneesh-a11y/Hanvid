import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrieveRagContext, enhancePromptWithRag } from "@/lib/rag";
import { submitLocalJob } from "@/lib/video-gen";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// POST /api/chats/[id]/messages { content }
// Creates a user message, queues video generation with the raw prompt
// asynchronously, and returns immediately with the pending message.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: chatId } = await params;
    const { content } = await req.json();

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Prompt content required" }, { status: 400 });
    }

    const chat = await db.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const prompt = content.trim().slice(0, 2000);

    // Retrieve RAG context and enhance prompt
    const context = await retrieveRagContext(prompt, 3);
    const enhancedPrompt = await enhancePromptWithRag(prompt, context);
    const isRagUsed = context.length > 0;

    // 1. Persist the user message.
    await db.message.create({
      data: { chatId, role: "user", content: prompt },
    });

    // 2. Create the assistant message (placeholder) + pending video record.
    const assistantMessage = await db.message.create({
      data: {
        chatId,
        role: "assistant",
        content: "Generating video…",
        enhancedPrompt: isRagUsed ? enhancedPrompt : null,
      },
    });
    const video = await db.video.create({
      data: {
        messageId: assistantMessage.id,
        status: "pending",
        progress: 0,
        source: "auto",
      },
    });

    // Update chat timestamp; name the chat after its first prompt.
    const isDefaultTitle = !chat.title || chat.title === "New Video Chat" || chat.title === "New Chat";
    const newTitle = prompt.length > 40 ? prompt.slice(0, 40).trimEnd() + "…" : prompt;
    await db.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date(), ...(isDefaultTitle ? { title: newTitle } : {}) },
    });

    // 3. Queue generation on the local Python GPU synchronously
    // This returns quickly because FastAPI queues the job and returns 202.
    // The browser will poll the REST endpoint to get progress.
    await submitLocalJob(enhancedPrompt, assistantMessage.id).catch((err) => {
      console.error("Failed to submit job to local Python service:", err);
    });

    return NextResponse.json(
      {
        message: assistantMessage,
        video,
        ragUsed: isRagUsed,
        ragContextCount: context.length,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/chats/[id]/messages error:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
