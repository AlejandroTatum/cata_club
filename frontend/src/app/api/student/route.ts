/**
 * GET /api/student?personaId=<id> — aggregated portal for the logged-in persona.
 *
 * One upstream call (`GET /portal/alumno/{id}`, issue #1592): the backend
 * returns the self profile, each representado's profile and the horarios /
 * membership-type catalogs in a single response, so this handler only maps it
 * to the `StudentPortalView` the browser has always received.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { BackendHorario } from "@/lib/server/attendance-adapter";
import {
  buildMembershipPlans,
  buildPortalProfile,
  type BackendPortalPerfil,
  type BackendTipoMembresiaCatalogo,
  type StudentPortalView,
} from "@/lib/server/student-adapter";

/**
 * `GET /asistencias/persona/{id}` is paginated (TRA-6). `RECENT_SESSIONS_LIMIT`
 * (student-adapter.ts) slices to the 30 most recent sessions after a
 * client-side sort, so the history the backend returns per profile must
 * actually contain those 30 — this stays comfortably above that.
 */
const HISTORIAL_PAGE_LIMIT = 200;

interface BackendPortalAlumno {
  titular: BackendPortalPerfil;
  representados: BackendPortalPerfil[];
  horarios: BackendHorario[];
  tipos: BackendTipoMembresiaCatalogo[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const personaIdParam = request.nextUrl.searchParams.get("personaId");
  const personaId = personaIdParam !== null ? Number(personaIdParam) : NaN;
  if (!Number.isInteger(personaId) || personaId <= 0) {
    return NextResponse.json({ message: "personaId inválido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/portal/alumno/${personaId}?historial_limite=${HISTORIAL_PAGE_LIMIT}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No autorizado" }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar la cuenta.");
  }
  const aggregate = (await result.response.json()) as BackendPortalAlumno;

  const horariosById = new Map(aggregate.horarios.map((horario) => [horario.id, horario]));
  const tiposById = new Map(aggregate.tipos.map((tipo) => [tipo.id, tipo]));

  const portal: StudentPortalView = {
    self: buildPortalProfile(aggregate.titular, horariosById, tiposById),
    representados: aggregate.representados.map((perfil) => buildPortalProfile(perfil, horariosById, tiposById)),
    membershipPlans: buildMembershipPlans(aggregate.tipos),
  };

  const response = NextResponse.json(portal);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
