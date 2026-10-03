// Shared constants for the WanVid app

// Admin portal access — only shown when this exact query param is present.
// Admins must type the full URL: https://<domain>/?portal=wan2-admin-secret
export const ADMIN_PORTAL_KEY = "wan2-admin-secret";
export const ADMIN_QUERY_PARAM = "portal";

// Ports for mini-services (gated through Caddy via XTransformPort)
export const WEBSOCKET_PORT = 3003;
export const PYTHON_MODEL_PORT = 3004;

// WebSocket connection URL (uses Caddy gateway transform)
export const WS_URL = `/?XTransformPort=${WEBSOCKET_PORT}`;

// Storage path for generated videos served by Next.js
export const VIDEOS_DIR = "public/videos";

// Model service base URL (called from Next.js backend only, through Caddy)
export const MODEL_SERVICE_BASE = `http://localhost:${PYTHON_MODEL_PORT}`;

// Video generation sources
export type VideoSource = "local";

// Admin header key
export const ADMIN_HEADER = "x-admin-key";
