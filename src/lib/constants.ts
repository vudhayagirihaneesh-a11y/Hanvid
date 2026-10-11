// Shared constants for the WanVid app

// Admin portal access — only shown when this exact query param is present.
// Admins must type the full URL: https://<domain>/?portal=wan2-admin-secret
export const ADMIN_PORTAL_KEY = "wan2-admin-secret";
export const ADMIN_QUERY_PARAM = "portal";

// Ports for mini-services (gated through Caddy via XTransformPort)
export const WEBSOCKET_PORT = 3003;
export const PYTHON_MODEL_PORT = 3004;

// WebSocket connection URL for the realtime progress service.
// Default: direct connection to the local socket.io service on port 3003
// (its CORS is open, so cross-origin from :3000 works).
// Behind the Caddy gateway, set NEXT_PUBLIC_WS_URL="/?XTransformPort=3003"
// in your environment instead — the old default silently connected to the
// Next.js server itself and never received any progress events locally.
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || `http://localhost:${WEBSOCKET_PORT}`;

// Storage path for generated videos served by Next.js
export const VIDEOS_DIR = "public/videos";

// Model service base URL (called from Next.js backend only, through Caddy)
export const MODEL_SERVICE_BASE = (process.env.MODEL_SERVICE_URL || process.env.PYTHON_SERVICE_URL || `http://localhost:${PYTHON_MODEL_PORT}`).trim().replace(/\/+$/, "");

// Video generation sources
export type VideoSource = "local";

// Admin header key
export const ADMIN_HEADER = "x-admin-key";
