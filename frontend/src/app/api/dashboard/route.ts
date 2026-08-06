/**
 * GET /api/dashboard — aggregate counts for the admin overview.
 *
 * Proxies to FastAPI's GET /dashboard/stats, which returns all four metrics
 * in a single query round-trip (avoids the N+1 / connection-pool exhaustion
 * that the old multi-call approach caused with large datasets).
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export interface DashboardStats {
  /** Everyone on the padrón, staff included — the "Miembros" tile. */
  totalPersonas: number;
  /**
   * The population that can hold a membership: the denominator of
   * "MEMBRESÍAS ACTIVAS · X de Y". Administradores and entrenadores are in
   * `totalPersonas` and never hold a membership, so using that count as the
   * denominator understates the ratio. See `DashboardStatsDTO` in
   * backend/app/presentacion/schemas/dashboard_schemas.py.
   */
  totalAlumnos: number;
  activeMemberships: number;
  pendingPayments: number;
  todaySchedules: number;
  personasSinMembresia: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/dashboard/stats");

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudieron cargar las estadísticas del panel." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar las estadísticas del panel.");
  }

  const stats: DashboardStats = await result.response.json();

  const response = NextResponse.json(stats);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
