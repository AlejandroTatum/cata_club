/**
 * POST /api/membresias/pagos/presencial — register an IN-PERSON first
 * inscription payment (issue #1402).
 *
 * Proxies FastAPI's `POST /membresias/pagos/presencial`, which is guarded by
 * `GestorPermisos(ROL_ADMIN)` and re-verifies server-side (never a
 * client-settable flag) that the payment is for ANOTHER person and that the
 * membership is a first inscription (INACTIVA, no approved payment).
 *
 * Outcome is decided entirely by the backend:
 * - EFECTIVO → APROBADO in the same request, with the regular reviewer/time
 *   audit (`validadoPorPersonaId`/`fechaValidacion`), membership active.
 * - TRANSFERENCIA → PENDIENTE_VALIDACION: the voucher travels in a SEPARATE
 *   request (`.../pagos/[pagoId]/voucher`), then the admin finalizes via the
 *   existing admin-only `.../pagos/[pagoId]/validar`. Never approved without
 *   the voucher; a failed upload leaves the payment pending for a retry.
 * - Self-service (admin's own payment) and renewals/subsequent payments are
 *   rejected (400) and must use the regular `POST /api/membresias/pagos`
 *   flow with the validation queue.
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

  const result = await backendFetchAuthed(request, "/membresias/pagos/presencial", {
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
      { message: "No se pudo registrar el pago presencial." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar el pago presencial.");
  }

  const created = await result.response.json();
  const response = NextResponse.json(created, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
