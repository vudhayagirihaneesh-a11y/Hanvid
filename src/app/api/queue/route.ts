import { NextResponse } from "next/server";
import { checkLocalService } from "@/lib/video-gen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/queue → public waitlist status for the banner above the prompt box.
//   state: "ready" (no wait) | "busy" (jobs ahead) | "warming" (model loading) | "offline"
export async function GET() {
  const s = await checkLocalService();
  if (!s.available) {
    return NextResponse.json({ state: "offline", waiting: 0, waitSeconds: 0 });
  }
  if (!s.modelLoaded) {
    return NextResponse.json({ state: "warming", waiting: 0, waitSeconds: 0 });
  }
  const q = s.queue ?? { waiting: 0, running: false, avg_seconds: 45, wait_seconds: 0 };
  const inFlight = q.waiting + (q.running ? 1 : 0);
  return NextResponse.json({
    state: inFlight > 0 ? "busy" : "ready",
    waiting: inFlight,
    waitSeconds: q.wait_seconds,
    avgSeconds: q.avg_seconds,
  });
}
