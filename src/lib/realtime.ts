import { io as ioc, Socket } from "socket.io-client";

// Backend-side realtime client. Connects to the WanVid progress service (port 3003)
// as a trusted backend and pushes generation progress updates so browsers receive
// them in real time.

const REALTIME_URL =
  process.env.REALTIME_URL || "http://localhost:3003";
const BACKEND_SECRET = process.env.BACKEND_SECRET || "wanvid-backend-trust";

const globalForRT = globalThis as unknown as {
  __wanvidRT: Socket | null;
  __wanvidRTConnecting: boolean;
};

function getSocket(): Socket | null {
  if (globalForRT.__wanvidRT?.connected) return globalForRT.__wanvidRT;
  if (globalForRT.__wanvidRTConnecting) return null;

  globalForRT.__wanvidRTConnecting = true;
  try {
    const sock = ioc(REALTIME_URL, {
      path: "/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 5000,
    });

    sock.on("connect", () => {
      sock.emit("register-backend", { secret: BACKEND_SECRET });
      globalForRT.__wanvidRTConnecting = false;
      console.log("[realtime-client] connected & registered as backend");
    });
    sock.on("disconnect", () => {
      console.log("[realtime-client] disconnected, will reconnect");
    });
    sock.on("connect_error", (err) => {
      globalForRT.__wanvidRTConnecting = false;
      console.warn("[realtime-client] connect error:", err.message);
    });

    globalForRT.__wanvidRT = sock;
    return sock;
  } catch (err) {
    globalForRT.__wanvidRTConnecting = false;
    console.warn("[realtime-client] init failed:", err);
    return null;
  }
}

export interface ProgressPayload {
  messageId: string;
  chatId?: string;
  status: "pending" | "generating" | "ready" | "failed";
  progress: number;
  phase?: "warming" | "queued" | "generating" | "finalizing";
  queuePosition?: number;
  queueLength?: number;
  etaSeconds?: number;
  videoUrl?: string;
  source?: string;
  errorMessage?: string;
}

/** Push a progress update to all subscribed browser clients. Best-effort. */
export function pushProgress(p: ProgressPayload) {
  const sock = getSocket();
  if (!sock?.connected) {
    // If not connected yet, the update is simply dropped (browsers will still
    // poll the REST endpoint as a fallback).
    return;
  }
  try {
    sock.emit("push-progress", p);
  } catch (err) {
    console.warn("[realtime-client] push failed:", err);
  }
}
