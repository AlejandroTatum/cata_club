/**
 * GET /api/membresias/coberturas/:id/comprobante — binary proxy of FastAPI's
 * on-demand official receipt for a 100% coverage (issue #1609). Owner,
 * representative or admin authorization is enforced backend-side
 * (`generar_comprobante_cobertura` in membresia_pago_servicio.py).
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendPdfGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const params = await props.params;
  return proxyBackendPdfGet(
    request,
    `/membresias/coberturas/${encodeURIComponent(params.id)}/comprobante`,
    "No se pudo descargar el recibo.",
  );
}
