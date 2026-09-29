/**
 * PATCH /api/membresias/pagos/:pagoId/validar — approve or reject a pending
 * payment.
 *
 * Proxies FastAPI's `PATCH /membresias/pagos/{pago_id}/validar`, which is
 * admin-only (`GestorPermisos(ROL_ADMIN)`): the validation queue's own write
 * action. Issue #1402's in-person transfer flow calls this AFTER the voucher
 * upload succeeds, so the approval always lands on complete evidence; a
 * TRANSFERENCIA without voucher still requires the audited exception
 * (`motivoExcepcionSinComprobante`) enforced by the backend service.
 *
 * The BFF does no business logic: it validates the payload shape, translates
 * camelCase → snake_case `PagoValidarDTO`, and relays the backend's status
 * (200 on success, 400 for state errors like "already validated" or "missing
 * rejection reason", 404 when the pago does not exist).
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ pagoId: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  const pagoId = parseNumericIdOrBadRequest(params.pagoId, "pago", { requireInteger: true });
  if (pagoId instanceof NextResponse) return pagoId;

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
    || typeof (body as Record<string, unknown>).estadoPago !== "string"
    || !["APROBADO", "RECHAZADO"].includes((body as Record<string, unknown>).estadoPago as string)
  ) {
    return NextResponse.json(
      { message: "estadoPago es obligatorio y debe ser APROBADO o RECHAZADO." },
      { status: 400 },
    );
  }

  const payload = body as {
    estadoPago: string;
    motivoRechazo?: unknown;
    motivoExcepcionSinComprobante?: unknown;
  };

  const result = await backendFetchAuthed(
    request,
    `/membresias/pagos/${pagoId}/validar`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado_pago: payload.estadoPago,
        ...(typeof payload.motivoRechazo === "string"
          ? { motivo_rechazo: payload.motivoRechazo }
          : {}),
        ...(typeof payload.motivoExcepcionSinComprobante === "string"
          ? { motivo_excepcion_sin_comprobante: payload.motivoExcepcionSinComprobante }
          : {}),
      }),
    },
  );
  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo validar el pago." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo validar el pago.");
  }

  const validated = await result.response.json();
  const response = NextResponse.json(validated);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
