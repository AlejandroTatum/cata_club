/**
 * GET /api/ranking/alumnos — proxies FastAPI's `/ranking/alumnos`.
 *
 * The roster behind the nivel-assignment screen (admin `/ranking` and trainer
 * `/trainer/nivel`). It replaced `/api/members` there: that aggregator starts
 * with the ADMINISTRADOR-only `GET /personas/`, so a trainer got a real 403
 * and the page never loaded a single student. `AlumnoParaNivelDTO` carries no
 * PII, which is what lets the backend serve it to ENTRENADOR too.
 *
 * The backend response is already camelCase and frontend-shaped (via
 * `ResponseBase`), so this handler passes it through unmodified — same style
 * as the sibling /api/ranking/niveles route.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/ranking/alumnos");
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron cargar los estudiantes." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar los estudiantes.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
