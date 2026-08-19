/**
 * BFF proxy — GET /api/membresias/tarifas
 *
 * Public read-only tariff catalog (issue #394, contract of issue #331): the
 * enrollment flow needs to show a plan's price BEFORE the visitor has any
 * session. This route MUST stay PUBLIC: using `proxyToBackend`/token
 * extraction here would 401 that anonymous flow. Follows the exact same
 * public shape as `api/personas/instituciones` (`backendFetch`, no token
 * extraction) — the only other anonymous BFF surface in the app. The shared
 * 503/502/200 response shaping lives in `publicCatalogGet`
 * (`@/lib/server/bff-helpers`), which both routes use.
 *
 * No query params to forward: the backend endpoint is deliberately
 * unpaginated (small, low-churn catalog, see
 * `backend/app/presentacion/routers/membresias_pagos_router.py`).
 *
 * `force-dynamic` is required for the same reason as `instituciones`:
 * without it, Next attempts to statically prerender the route at build
 * time, which fails in Docker when the backend isn't reachable yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { publicCatalogGet } from "@/lib/server/bff-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return publicCatalogGet("/membresias/tarifas", forwardedForFrom(request));
}
