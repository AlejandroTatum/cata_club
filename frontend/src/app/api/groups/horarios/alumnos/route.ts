/**
 * BFF proxy — GET /api/groups/horarios/alumnos
 *
 * Roster of EVERY training schedule in one call (TRA-7). Proxies to
 * FastAPI's GET /asistencias/horarios/alumnos, which replaced the N calls
 * (one per horario, via `/api/groups/horarios/[id]/alumnos`) `/groups` used
 * to make to build its "N inscriptos" card counts. Deliberately unpaginated,
 * same as the backend route — see its own comment.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAccessToken, proxyToBackend, unauthorizedResponse } from "@/lib/server/bff-helpers";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  return proxyToBackend("/asistencias/horarios/alumnos", { method: "GET", accessToken });
}
