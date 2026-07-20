/**
 * GET /api/dashboard — aggregate counts for the admin overview (Fase 7).
 *
 * This composes counts directly from FastAPI resources rather than calling
 * other Next.js Route Handlers over HTTP. Membership totals come from the
 * backend aggregate endpoint so this route never fans out per membership.
 *
 * Counting decisions:
 *  - `totalPersonas` reads FastAPI's own `total` from the paginated
 *    `/personas/` response (accurate regardless of `limit`), not
 *    `items.length`.
 *  - `activeMemberships` is counted by FastAPI directly from active
 *    memberships, rather than inferring it from a bounded payment page.
 *  - `pendingPayments` reads `total` from `/membresias/pagos?estado_pago=
 *    PENDIENTE_VALIDACION` — the same raw queue FastAPI backs the /payments
 *    screen with (one row per Pago, not deduped per persona), so this
 *    number matches what the admin sees after clicking through.
 *  - `todaySchedules` filters `/asistencias/horarios` by today's weekday,
 *    computed in the club's canonical timezone (America/Guayaquil, already
 *    used by src/app/members/members-utils.ts) rather than the container's
 *    local time.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { BackendPagoListItem } from "@/lib/server/payments-adapter";
import type { BackendHorario, BackendDiaSemana } from "@/lib/server/attendance-adapter";

interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

interface MembershipStatsResponse {
  activeMemberships: number;
}

export interface DashboardStats {
  totalPersonas: number;
  activeMemberships: number;
  pendingPayments: number;
  todaySchedules: number;
}

const WEEKDAY_TO_DIA_SEMANA: Record<string, BackendDiaSemana> = {
  Mon: "LUNES",
  Tue: "MARTES",
  Wed: "MIERCOLES",
  Thu: "JUEVES",
  Fri: "VIERNES",
  Sat: "SABADO",
  Sun: "DOMINGO",
};

function todayBackendDiaSemana(): BackendDiaSemana {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil",
    weekday: "short",
  }).format(new Date());
  return WEEKDAY_TO_DIA_SEMANA[weekday] ?? "LUNES";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const [personasResult, membershipStatsResult, pendientesResult, horariosResult] = await Promise.all([
    backendFetchAuthed(request, "/personas/?limit=1"),
    backendFetchAuthed(request, "/membresias/estadisticas"),
    backendFetchAuthed(request, "/membresias/pagos?estado_pago=PENDIENTE_VALIDACION&limit=1"),
    backendFetchAuthed(request, "/asistencias/horarios"),
  ]);

  if (!personasResult.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las estadísticas del panel." }, { status: personasResult.status });
  }
  if (!personasResult.response.ok) {
    return passthroughBackendError(personasResult.response, "No se pudieron cargar las estadísticas del panel.");
  }
  const totalPersonas = ((await personasResult.response.json()) as PaginatedResponse<unknown>).total;

  const activeMemberships =
    membershipStatsResult.ok && membershipStatsResult.response.ok
      ? ((await membershipStatsResult.response.json()) as MembershipStatsResponse).activeMemberships
      : 0;

  const pendingPayments =
    pendientesResult.ok && pendientesResult.response.ok
      ? ((await pendientesResult.response.json()) as PaginatedResponse<BackendPagoListItem>).total
      : 0;

  const horarios: BackendHorario[] =
    horariosResult.ok && horariosResult.response.ok ? await horariosResult.response.json() : [];
  const today = todayBackendDiaSemana();
  const todaySchedules = horarios.filter((horario) => horario.diaSemana === today).length;

  const stats: DashboardStats = { totalPersonas, activeMemberships, pendingPayments, todaySchedules };

  const response = NextResponse.json(stats);
  if (personasResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personasResult.refreshedAccessToken });
  }
  return response;
}
