/**
 * GET /api/student?personaId=<id> — aggregated portal for the logged-in persona.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { BackendPersonaFull } from "@/lib/server/members-adapter";
import type { BackendAsistencia, BackendHorario } from "@/lib/server/attendance-adapter";
import {
  buildMembershipPlans,
  buildMembershipView,
  buildRecentSessions,
  buildStudentProfileView,
  type BackendMembresiaPropia,
  type BackendTipoMembresiaCatalogo,
  type MembershipView,
  type StudentPortalView,
  type StudentProfileView,
} from "@/lib/server/student-adapter";

async function fetchMemberships(
  request: NextRequest,
  personaId: number,
): Promise<BackendMembresiaPropia[]> {
  const result = await backendFetchAuthed(request, `/membresias/mias?persona_id=${personaId}`);
  if (!result.ok || !result.response.ok) return [];
  return result.response.json() as Promise<BackendMembresiaPropia[]>;
}

async function fetchProfile(
  request: NextRequest,
  personaId: number,
  horariosById: Map<number, BackendHorario>,
  tiposById: Map<number, BackendTipoMembresiaCatalogo>,
): Promise<StudentProfileView | null> {
  const [personaResult, historialResult, memberships] = await Promise.all([
    backendFetchAuthed(request, `/personas/${personaId}`),
    backendFetchAuthed(request, `/asistencias/persona/${personaId}`),
    fetchMemberships(request, personaId),
  ]);

  if (!personaResult.ok || !personaResult.response.ok) return null;
  const persona = (await personaResult.response.json()) as BackendPersonaFull;

  let representante: { nombres: string; apellidos: string } | null = null;
  if (persona.representanteId) {
    const repResult = await backendFetchAuthed(request, `/personas/${persona.representanteId}`);
    if (repResult.ok && repResult.response.ok) {
      const repPersona = (await repResult.response.json()) as BackendPersonaFull;
      representante = { nombres: repPersona.nombres, apellidos: repPersona.apellidos };
    }
  }

  const historial: BackendAsistencia[] =
    historialResult.ok && historialResult.response.ok ? await historialResult.response.json() : [];
  const recentSessions = buildRecentSessions(historial, horariosById);

  const activeMembership = memberships.find((m) => m.estado === "ACTIVA" || m.estado === "VENCIDA") ?? memberships[0] ?? null;
  const membership = activeMembership ? buildMembershipView(activeMembership, tiposById) : null;

  return buildStudentProfileView(persona, recentSessions, membership, representante);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const personaIdParam = request.nextUrl.searchParams.get("personaId");
  const personaId = personaIdParam !== null ? Number(personaIdParam) : NaN;
  if (!Number.isInteger(personaId) || personaId <= 0) {
    return NextResponse.json({ message: "personaId inválido." }, { status: 400 });
  }

  const [representadosResult, horariosResult, tiposResult] = await Promise.all([
    backendFetchAuthed(request, `/personas/${personaId}/representados`),
    backendFetchAuthed(request, "/asistencias/horarios"),
    backendFetchAuthed(request, "/membresias/tipos"),
  ]);

  if (!representadosResult.ok) {
    return NextResponse.json({ message: "No autorizado" }, { status: representadosResult.status });
  }
  if (!representadosResult.response.ok) {
    return passthroughBackendError(representadosResult.response, "No se pudo cargar la cuenta.");
  }
  const representadosPersonas = (await representadosResult.response.json()) as BackendPersonaFull[];

  const horarios: BackendHorario[] =
    horariosResult.ok && horariosResult.response.ok ? await horariosResult.response.json() : [];
  const horariosById = new Map(horarios.map((horario) => [horario.id, horario]));

  const tipos: BackendTipoMembresiaCatalogo[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];
  const tiposById = new Map(tipos.map((tipo) => [tipo.id, tipo]));

  const [self, ...representados] = await Promise.all([
    fetchProfile(request, personaId, horariosById, tiposById),
    ...representadosPersonas.map((persona) => fetchProfile(request, persona.id, horariosById, tiposById)),
  ]);

  const portal: StudentPortalView = {
    self,
    representados: representados.filter((profile): profile is StudentProfileView => profile !== null),
    membershipPlans: buildMembershipPlans(tipos),
  };

  const response = NextResponse.json(portal);
  if (representadosResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: representadosResult.refreshedAccessToken });
  }
  return response;
}
