/**
 * GET /api/membresias/[id]/deuda — a membership's derived owed months.
 *
 * BFF proxy to FastAPI's `GET /membresias/{membresia_id}/deuda` (issue #284).
 * ADMINISTRADOR-only in the backend: the debt is derived (no stored column)
 * and must never reach the student/representative. We propagate its 401/403.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { DeudaMembresia } from "@/services/api";

interface RouteContext {
  params: { id: string };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = Number(context.params.id);
  if (Number.isNaN(membresiaId)) {
    return NextResponse.json({ message: "El id de membresía no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/deuda`);

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo consultar la deuda de la membresía." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo consultar la deuda de la membresía.");
  }

  const data = (await result.response.json()) as DeudaMembresia;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
