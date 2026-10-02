/**
 * GET /api/actividad/avanzadas?rango=1h|24h|7d — admin-only "Actividad del club" (avanzadas).
 *
 * Proxies to FastAPI's GET /actividad/avanzadas and forwards ONLY a validated
 * `rango`: any other query parameter is dropped, and an unknown range is
 * rejected here with a 422 (the backend's own answer) instead of travelling to
 * the backend inside a URL the client controls. The role check is the
 * backend's; its 401/403 pass through untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

const RANGES: readonly string[] = ["1h", "24h", "7d"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rango = request.nextUrl.searchParams.get("rango");
  if (rango !== null && !RANGES.includes(rango)) {
    return NextResponse.json({ message: "El periodo solicitado no es válido." }, { status: 422 });
  }

  const query = rango === null ? "" : `?rango=${rango}`;
  const result = await backendFetchAuthed(request, `/actividad/avanzadas${query}`);

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar la actividad del club." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar la actividad del club.");
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
