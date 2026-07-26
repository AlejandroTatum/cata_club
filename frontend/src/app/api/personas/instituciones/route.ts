/**
 * BFF proxy — GET /api/personas/instituciones
 *
 * Feeds the school selector at `student/enroll` (child-enrollment wizard),
 * a page rendered with NO `ProtectedRoute` wrapper. This route MUST stay
 * PUBLIC: using `proxyToBackend`/`extractAccessToken` here would 401 that
 * page's anonymous/self-service visitors. Follows the same public shape as
 * `auth/recuperar-contrasenia` (`backendFetch`, no token extraction).
 *
 * `force-dynamic` is required even though this reads nothing from
 * `request`: without it, Next attempts to statically prerender the route at
 * build time, which fails in Docker when the backend isn't reachable yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const result = await backendFetch("/personas/instituciones", { method: "GET" });

  if (!result.ok) {
    return NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 503 });
  }

  const response = result.data;
  if (!response.ok) {
    return NextResponse.json(
      { error: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` },
      { status: 502 },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_response", message: "Respuesta del servidor inválida." },
      { status: 502 },
    );
  }

  return NextResponse.json(json, { status: 200 });
}
