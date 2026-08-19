/**
 * BFF proxy — GET /api/membresias/tarifas
 *
 * Public read-only tariff catalog (issue #394, contract of issue #331): the
 * enrollment flow needs to show a plan's price BEFORE the visitor has any
 * session. This route MUST stay PUBLIC: using `proxyToBackend`/token
 * extraction here would 401 that anonymous flow. Follows the exact same
 * public shape as `api/personas/instituciones` (`backendFetch`, no token
 * extraction) — the only other anonymous BFF surface in the app.
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
import { backendFetch, forwardedForFrom } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetch(
    "/membresias/tarifas",
    { method: "GET" },
    { forwardedFor: forwardedForFrom(request) },
  );

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
