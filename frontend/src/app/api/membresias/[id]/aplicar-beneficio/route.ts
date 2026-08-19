/**
 * POST /api/membresias/[id]/aplicar-beneficio — self-service: apply the
 * caller's active 100% benefit to a whole number of months, with no `Pago`
 * created (issue #400, slice 06).
 *
 * Proxies FastAPI's `POST /membresias/{membresia_id}/aplicar-beneficio`
 * (membresias_pagos_router.py). Autoservicio, NOT admin-only: the backend
 * authorizes owner or their representative only (never an admin acting "on
 * their behalf" — the admin already exercised their part when they granted
 * the `AsignacionDescuento`), enforced inside
 * `PagoServicio.aplicar_beneficio_bonificado`. This handler stays open to any
 * authenticated caller and relays the backend's 401/403/400/422 — same
 * pattern as `POST /api/membresias/pagos`.
 *
 * Body carries only `meses` (a whole number of months, `gt=0, le=12` on the
 * backend) — no `monto`, no `tipoPago`, no voucher: a 100% benefit never
 * creates a `Pago`, so there is no amount or payment method to collect.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = Number(context.params.id);
  if (Number.isNaN(membresiaId)) {
    return NextResponse.json({ message: "El id de membresía no es válido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).meses !== "number"
  ) {
    return NextResponse.json({ message: "El campo meses es obligatorio y debe ser numérico." }, { status: 400 });
  }

  const meses = (body as { meses: number }).meses;

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/aplicar-beneficio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meses }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo aplicar el beneficio." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo aplicar el beneficio.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
