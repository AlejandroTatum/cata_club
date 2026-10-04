/**
 * GET /api/membresias/coberturas/persona/:id — proxies FastAPI's
 * `GET /membresias/coberturas/persona/{persona_id}` (issue #1369, slice 3).
 * Returns a persona's 100%-coverage activations so the student payment
 * history can merge them as real rows: applying the benefit never created a
 * `Pago`, so without this read the covered month was invisible. Dueño-or-
 * representante-or-admin authorization is enforced backend-side
 * (`listar_coberturas_de_persona` in membresia_pago_servicio.py), not here.
 * Response is already camelCase and frontend-shaped
 * (`CoberturaBonificadaResponseDTO`) — same pass-through pattern as
 * ../../pagos/persona/[id]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const params = await props.params;
  const result = await backendFetchAuthed(request, `/membresias/coberturas/persona/${encodeURIComponent(params.id)}`);
  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo cargar tu historial de coberturas." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar tu historial de coberturas.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
