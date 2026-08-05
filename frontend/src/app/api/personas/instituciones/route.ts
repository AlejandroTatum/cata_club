/**
 * BFF proxy — GET /api/personas/instituciones
 *
 * Feeds the school selector at `student/enroll` (child-enrollment wizard),
 * a page rendered with NO `ProtectedRoute` wrapper. This route MUST stay
 * PUBLIC: using `proxyToBackend`/`extractAccessToken` here would 401 that
 * page's anonymous/self-service visitors. Follows the same public shape as
 * `auth/recuperar-contrasenia` (`backendFetch`, no token extraction).
 *
 * `skip`/`limit` are forwarded verbatim to the backend — the backend
 * validates the bounds (`skip >= 0`, `1 <= limit <= 200`). Forwarding them
 * is load-bearing: `fetchInstituciones()` drains the full catalog page by
 * page, and without this every iteration would re-fetch page 1 forever.
 *
 * `force-dynamic` is required even though this used to read nothing from
 * `request`: without it, Next attempts to statically prerender the route at
 * build time, which fails in Docker when the backend isn't reachable yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const skip = searchParams.get("skip");
  const limit = searchParams.get("limit");
  if (skip) qs.set("skip", skip);
  if (limit) qs.set("limit", limit);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  const result = await backendFetch(`/personas/instituciones${suffix}`, { method: "GET" });

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
