import { NextRequest, NextResponse } from "next/server";
import { ADMIN_HEADER, ADMIN_PORTAL_KEY } from "@/lib/constants";

/**
 * Admin authorization check.
 *
 * Admin endpoints accept the secret either via:
 *  - the `x-admin-key` header, OR
 *  - the `key` query parameter (matching ADMIN_PORTAL_KEY)
 *
 * Returns null if authorized, otherwise a 401 NextResponse.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const headerVal = req.headers.get(ADMIN_HEADER);
  const queryVal = req.nextUrl.searchParams.get("key");
  if (headerVal === ADMIN_PORTAL_KEY || queryVal === ADMIN_PORTAL_KEY) {
    return null;
  }
  return NextResponse.json(
    { error: "Unauthorized — admin access required" },
    { status: 401 },
  );
}
