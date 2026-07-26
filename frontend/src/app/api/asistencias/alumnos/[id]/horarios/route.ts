/**
 * BFF proxy — GET /api/asistencias/alumnos/[id]/horarios
 *
 * The training slots a student is actually ASSIGNED to (`AlumnoHorario` rows,
 * created by an admin from `/groups`), not the club's full schedule list.
 * Proxies to FastAPI's GET /asistencias/alumnos/{persona_id}/horarios.
 *
 * This is the only source in the system from which a truthful "your next
 * training session" can be derived: `HorarioEntrenamiento` alone carries no
 * link to the persona or nivel it serves (see the doc comment on
 * `src/lib/server/attendance-adapter.ts`), so the family portal used to print
 * the last RECORDED session under the heading "Entrenamientos". The
 * assignment row does carry that link, and the backend exposes it to any
 * authenticated caller — the same gate `/api/groups/horarios/[id]/alumnos`
 * already proxies, so this widens no exposure the product did not have.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAccessToken, proxyToBackend, unauthorizedResponse } from "@/lib/server/bff-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  return proxyToBackend(`/asistencias/alumnos/${encodeURIComponent(params.id)}/horarios`, {
    method: "GET",
    accessToken,
  });
}
