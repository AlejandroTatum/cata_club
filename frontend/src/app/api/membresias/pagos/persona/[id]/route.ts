/**
 * GET /api/membresias/pagos/persona/:id — proxies FastAPI's
 * `GET /membresias/pagos/persona/{persona_id}`. Returns a persona's own
 * payment history, any status — including RECHAZADO with its
 * `motivoRechazo` — so a student can see why theirs was rejected. Dueño-or-
 * representante-or-admin authorization is enforced backend-side
 * (`listar_pagos_de_persona` in membresia_pago_servicio.py), not here.
 * Response is already camelCase and frontend-shaped (`PagoResponseDTO`), so
 * this handler passes it through unmodified — same pattern as
 * ../../../../ranking/[id]/justificativos/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, `/membresias/pagos/persona/${encodeURIComponent(params.id)}`);
  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudieron cargar sus pagos." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar sus pagos.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
