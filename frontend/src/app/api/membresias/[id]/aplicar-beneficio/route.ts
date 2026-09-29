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
 * Body carries no fields (issue #1369): one activation grants EXACTLY one
 * month — the period is no longer the caller's choice — so an empty `{}` is
 * forwarded. No `monto`, no `tipoPago`, no voucher: a 100% benefit never
 * creates a `Pago`, so there is no amount or payment method to collect.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = parseNumericIdOrBadRequest((await context.params).id, "membresía");
  if (membresiaId instanceof NextResponse) return membresiaId;

  // JSON validity stays a 400; the content itself is ignored (issue #1369:
  // no field is required — a stale client's `meses` is neither read nor
  // forwarded). The backend grants exactly one month per activation.
  try {
    await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/aplicar-beneficio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
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
