/**
 * BFF proxy — PATCH /api/membresias/tipos/[id] (issue #394, inside #400)
 *
 * Partial update of a catalog tariff. Proxies FastAPI's
 * `PATCH /membresias/tipos/{id}` (`TipoMembresiaUpdateDTO`, applied with
 * `exclude_unset`), so only the keys present in the incoming body travel.
 *
 * Mirrors `app/api/descuentos/[id]/route.ts`, the other admin catalog edit,
 * down to the guard order: a non-numeric id and an empty body are both
 * rejected here, before the trip, and a backend refusal is relayed with its
 * own message rather than flattened.
 *
 * Editing a tariff never rewrites history. `membresia.monto_aplicado` is a
 * COPY of the price taken when the plan was assigned, and every payment
 * freezes its own values, so a new price reaches future payments only — the
 * backend tests (`test_tarifas_administracion.py`) are what hold that rule.
 *
 * There is no `activo` here and no DELETE: `TipoMembresia` has no soft-delete
 * column, so retiring a plan is out of scope for #394 as written.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface ActualizarTipoMembresiaBody {
  categoria?: unknown;
  precio?: unknown;
  modalidad?: unknown;
}

const UPDATABLE_FIELDS = ["categoria", "precio", "modalidad"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { message: "Identificador de tipo de membresía inválido." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "JSON inválido en el cuerpo de la solicitud." },
      { status: 400 },
    );
  }

  const parsed = (typeof body === "object" && body !== null
    ? body
    : {}) as ActualizarTipoMembresiaBody;
  const payload: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (parsed[field] !== undefined) payload[field] = parsed[field];
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ message: "No hay campos para actualizar." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/tipos/${params.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo actualizar la tarifa." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar la tarifa.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
