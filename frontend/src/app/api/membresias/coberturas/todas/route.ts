/**
 * GET /api/membresias/coberturas/todas — admin review list of 100% coverages
 * (issue #1609). Proxies FastAPI's `GET /membresias/coberturas/todas`;
 * admin-only is enforced backend-side. Response is already camelCase.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

const ERROR_MESSAGE = "No se pudieron cargar las bonificaciones.";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const qs = new URLSearchParams();
  for (const key of ["skip", "limit"]) {
    const value = searchParams.get(key);
    if (value !== null) qs.set(key, value);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  const result = await backendFetchAuthed(request, `/membresias/coberturas/todas${suffix}`);
  if (!result.ok) {
    return NextResponse.json({ message: ERROR_MESSAGE }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, ERROR_MESSAGE);
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
