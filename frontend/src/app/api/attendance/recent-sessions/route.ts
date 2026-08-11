/**
 * GET /api/attendance/recent-sessions — proxies FastAPI's
 * `/asistencias/ultimas-listas`.
 *
 * "Las últimas listas del club" card on the trainer panel (Fix 8 / DSH-2,
 * decisiones-de-negocio-2026-08-11.md §8). Deliberately no author and no
 * per-student name: `Asistencia` doesn't record who took the list
 * (modelos.py:536), and there's no entrenador–horario relation to filter by
 * (issue #13) — the card lists the club's own recent sessions, translating
 * each backend `BackendUltimaLista` into a `RecentSession` the same way
 * `attendance/records/route.ts` builds `AttendanceRecord`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { buildRecentSession, type BackendUltimaLista } from "@/lib/server/attendance-adapter";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit");
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";

  const result = await backendFetchAuthed(request, `/asistencias/ultimas-listas${query}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las últimas listas." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar las últimas listas.");
  }

  const listas = (await result.response.json()) as BackendUltimaLista[];
  const response = NextResponse.json(listas.map(buildRecentSession));
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
