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
import { proxyBackendJsonGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const params = await props.params;
  return proxyBackendJsonGet(
    request,
    `/membresias/coberturas/persona/${encodeURIComponent(params.id)}`,
    "No se pudo cargar tu historial de coberturas.",
  );
}
