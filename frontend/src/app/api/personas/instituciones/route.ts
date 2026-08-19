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
 *
 * The shared 503/502/200 response shaping (backend unreachable / backend
 * error / invalid JSON / passthrough) lives in `publicCatalogGet`
 * (`@/lib/server/bff-helpers`), shared with `api/membresias/tarifas` (issue
 * #394) — this route still builds its own `skip`/`limit` query string,
 * since that part is specific to this endpoint's pagination.
 */

import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { publicCatalogGet } from "@/lib/server/bff-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const skip = searchParams.get("skip");
  const limit = searchParams.get("limit");
  if (skip) qs.set("skip", skip);
  if (limit) qs.set("limit", limit);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  return publicCatalogGet(`/personas/instituciones${suffix}`, forwardedForFrom(request));
}
