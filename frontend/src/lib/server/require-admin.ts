/**
 * Server-side ADMINISTRADOR gate for Route Handlers whose backend calls are
 * allowed to a person for themselves (`titular o ADMINISTRADOR`) but whose
 * purpose is admin-only — e.g. the batch carnets, which read other people's
 * portals. The page's `ProtectedRoute` is UX; this is the boundary.
 *
 * It asks the backend who the caller is (`/auth/me`) rather than decoding the
 * token here, for the reason `middleware-utils.ts` gives: the backend is the
 * authority on roles.
 *
 * ⚠️ Server-only — import only from Route Handlers (`src/app/api/**`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { backendFetchAuthed } from "@/lib/server/backend-client";

export type AdminCheck =
  | { ok: true; refreshedAccessToken?: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(request: NextRequest): Promise<AdminCheck> {
  const result = await backendFetchAuthed(request, "/auth/me", { method: "GET", cache: "no-store" });
  if (!result.ok) {
    return { ok: false, response: NextResponse.json({ message: "No autorizado" }, { status: result.status }) };
  }
  if (!result.response.ok) {
    return { ok: false, response: NextResponse.json({ message: "No autorizado" }, { status: 401 }) };
  }
  const me = (await result.response.json().catch(() => null)) as { roles?: unknown } | null;
  const roles = Array.isArray(me?.roles) ? me.roles : [];
  if (!roles.includes("ADMINISTRADOR")) {
    return { ok: false, response: NextResponse.json({ message: "Solo un administrador puede imprimir carnets." }, { status: 403 }) };
  }
  return { ok: true, refreshedAccessToken: result.refreshedAccessToken };
}
