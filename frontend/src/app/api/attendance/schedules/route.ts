/**
 * GET /api/attendance/schedules — proxies FastAPI's `/asistencias/horarios`.
 *
 * BFF Route Handler: any authenticated user may list schedules (backend only
 * requires a valid token, no role restriction). Schedules carry no trainer:
 * the club does not assign trainers to schedules (issue #13). Consumed by
 * the admin `/attendance` overview and the trainer session-selection step in
 * `/trainer/attendance`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { buildTrainingSchedule, type BackendHorario } from "@/lib/server/attendance-adapter";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const horariosResult = await backendFetchAuthed(request, "/asistencias/horarios");
  if (!horariosResult.ok) {
    return NextResponse.json({ message: "No se pudieron cargar los horarios." }, { status: horariosResult.status });
  }
  if (!horariosResult.response.ok) {
    return passthroughBackendError(horariosResult.response, "No se pudieron cargar los horarios.");
  }

  const horarios = (await horariosResult.response.json()) as BackendHorario[];

  const schedules = horarios.map((horario) => buildTrainingSchedule(horario));

  const response = NextResponse.json(schedules);
  if (horariosResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: horariosResult.refreshedAccessToken });
  }
  return response;
}
