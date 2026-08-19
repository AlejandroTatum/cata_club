/**
 * POST /api/membresias/pagos/:pagoId/corregir — corrección financiera
 * auditable de un pago YA aprobado (issue #400, criterio 7).
 *
 * Proxies FastAPI's `POST /membresias/pagos/{pago_id}/corregir`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). `CorreccionPagoDTO` on the
 * backend is a plain snake_case Pydantic model with NO alias generator (it
 * is a write DTO, not a `ResponseBase` subtype) — this handler translates
 * the frontend's camelCase body explicitly, same pattern as
 * `POST /api/membresias/pagos` (register pago). Only the six correctable
 * fields that were actually SENT are forwarded (all optional except
 * `motivo`): an omitted field means "no change for that field", which is
 * exactly what `exclude_unset` on the backend needs to see — sending an
 * explicit `undefined`/`null` for an untouched field would defeat that.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface CorreccionPagoBody {
  tarifaMensualAplicada?: unknown;
  mesesComprados?: unknown;
  montoBase?: unknown;
  monto?: unknown;
  fechaInicio?: unknown;
  fechaFin?: unknown;
  motivo?: unknown;
}

const CAMPO_A_SNAKE: Record<string, string> = {
  tarifaMensualAplicada: "tarifa_mensual_aplicada",
  mesesComprados: "meses_comprados",
  montoBase: "monto_base",
  monto: "monto",
  fechaInicio: "fecha_inicio",
  fechaFin: "fecha_fin",
};

export async function POST(
  request: NextRequest,
  { params }: { params: { pagoId: string } },
): Promise<NextResponse> {
  const pagoId = Number(params.pagoId);
  if (!Number.isInteger(pagoId)) {
    return NextResponse.json({ message: "El id de pago no es válido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const payload = body as CorreccionPagoBody;
  if (typeof payload.motivo !== "string" || payload.motivo.trim().length === 0) {
    return NextResponse.json({ message: "El motivo de la corrección es obligatorio." }, { status: 400 });
  }

  const backendBody: Record<string, unknown> = { motivo: payload.motivo };
  for (const [campo, snake] of Object.entries(CAMPO_A_SNAKE)) {
    const valor = (payload as Record<string, unknown>)[campo];
    if (valor !== undefined) backendBody[snake] = valor;
  }

  const result = await backendFetchAuthed(request, `/membresias/pagos/${pagoId}/corregir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo registrar la corrección." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar la corrección.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
