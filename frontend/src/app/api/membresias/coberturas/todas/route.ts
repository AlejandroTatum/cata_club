/**
 * GET /api/membresias/coberturas/todas — admin review list of 100% coverages
 * (issue #1609). Proxies FastAPI's `GET /membresias/coberturas/todas`;
 * admin-only is enforced backend-side. Response is already camelCase.
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/server/backend-client";

const ERROR_MESSAGE = "No se pudieron cargar las bonificaciones.";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const qs = new URLSearchParams();
  for (const key of ["skip", "limit"]) {
    const value = searchParams.get(key);
    if (value !== null) qs.set(key, value);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  return proxyBackendJsonGet(request, `/membresias/coberturas/todas${suffix}`, ERROR_MESSAGE);
}
