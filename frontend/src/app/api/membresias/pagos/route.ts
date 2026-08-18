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
 *
 * `meses` replaces `monto` (issue #400): the user picks a whole number of
 * months, never a free-form amount — `PagoCreateDTO.meses` (`gt=0, le=12`)
 * is what the backend validates now, and it computes
 * `monto_base = tarifa_vigente * meses` itself. This handler only checks
 * that the field is a `number` (a stale client sending a decimal string
 * would still be caught downstream by Pydantic's `int` coercion, but this
 * gate exists so a malformed request fails fast with the same 400 shape as
 * every other required-field check here, not a raw backend 422).
 *
 * Fix período de cobertura (PAG-5): `fechaInicio`/`fechaFin` are no longer
 * read from the body or forwarded. The backend now derives the coverage
 * period itself from `meses` — the old contract let the client hand it ANY
 * range regardless of the amount (a one-month payment could ask for a year
 * of coverage; reproduced live against QA, see
 * docs/archive/fixes/06-periodo-de-cobertura.md). Forwarding a field the
 * backend now ignores would just be the next confusion.
 *
 * Same reasoning killed `descuentoIds` (issue #398): the backend resolves a
 * payment's discount from the persona's ASSIGNED benefit
 * (`asignarBeneficio`/`retirarBeneficio`, `/api/personas/[id]/beneficio`)
 * and ignores `descuento_ids` entirely now, so this handler no longer reads
 * or forwards it — any stray value a stale client still sends is dropped
 * the same way a stray `fechaInicio`/`fechaFin` is.
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
    || typeof (body as Record<string, unknown>).meses !== "number"
    || typeof (body as Record<string, unknown>).tipoPago !== "string"
    || typeof (body as Record<string, unknown>).personaId !== "number"
    || typeof (body as Record<string, unknown>).membresiaId !== "number"
  ) {
    return NextResponse.json(
      { message: "Faltan campos obligatorios (meses, tipoPago, personaId, membresiaId)." },
      { status: 400 },
    );
  }

  const payload = body as {
    meses: number;
    tipoPago: string;
    personaId: number;
    membresiaId: number;
  };

  const result = await backendFetchAuthed(request, "/membresias/pagos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meses: payload.meses,
      tipo_pago: payload.tipoPago,
      persona_id: payload.personaId,
      membresia_id: payload.membresiaId,
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
