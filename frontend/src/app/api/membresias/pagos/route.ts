/**
 * POST /api/membresias/pagos — register a new pending payment.
 *
 * Proxies FastAPI's `POST /membresias/pagos` (see
 * membresias_pagos_router.py:157). The backend enforces owner/
 * representative / ADMIN authorization at the service layer
 * (PagoServicio.registrar_pago), so this handler is open to any
 * authenticated caller — same pattern as the voucher upload route.
 *
 * Accepts camelCase JSON from the frontend and translates to the
 * snake_case `PagoCreateDTO` the backend expects.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "JSON inválido en el cuerpo de la solicitud." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).monto !== "number"
    || typeof (body as Record<string, unknown>).tipoPago !== "string"
    || typeof (body as Record<string, unknown>).fechaInicio !== "string"
    || typeof (body as Record<string, unknown>).fechaFin !== "string"
    || typeof (body as Record<string, unknown>).personaId !== "number"
    || typeof (body as Record<string, unknown>).membresiaId !== "number"
  ) {
    return NextResponse.json(
      { message: "Faltan campos obligatorios (monto, tipoPago, fechaInicio, fechaFin, personaId, membresiaId)." },
      { status: 400 },
    );
  }

  // Issue #12: optional catalog discounts to apply on this registration.
  // Optional and default-absent so pre-discount callers are unchanged; when
  // present it must be a list of numeric ids (the backend's `descuento_ids`).
  const rawDescuentoIds = (body as Record<string, unknown>).descuentoIds;
  if (
    rawDescuentoIds !== undefined
    && (!Array.isArray(rawDescuentoIds) || rawDescuentoIds.some((id) => typeof id !== "number"))
  ) {
    return NextResponse.json(
      { message: "descuentoIds debe ser una lista de identificadores numéricos." },
      { status: 400 },
    );
  }

  const payload = body as {
    monto: number;
    tipoPago: string;
    fechaInicio: string;
    fechaFin: string;
    personaId: number;
    membresiaId: number;
    descuentoIds?: number[];
  };

  const result = await backendFetchAuthed(request, "/membresias/pagos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      monto: payload.monto,
      tipo_pago: payload.tipoPago,
      fecha_inicio: payload.fechaInicio,
      fecha_fin: payload.fechaFin,
      persona_id: payload.personaId,
      membresia_id: payload.membresiaId,
      ...(payload.descuentoIds !== undefined ? { descuento_ids: payload.descuentoIds } : {}),
    }),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo registrar el pago." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar el pago.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
