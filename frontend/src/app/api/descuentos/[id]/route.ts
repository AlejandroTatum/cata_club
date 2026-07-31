/**
 * BFF proxy — PATCH /api/descuentos/[id] (issue #12)
 *
 * Partial update of a catalog discount: rename, change value/modality, and
 * the SOFT toggle (`activo`) that replaces deletion. Proxies FastAPI's
 * `PATCH /descuentos/{id}` (`DescuentoUpdateDTO`, applied with
 * `exclude_unset`), so only the keys present in the incoming body are
 * forwarded — an explicit `null` in `porcentaje`/`monto` is meaningful (it
 * clears the other modality) and must survive the trip.
 *
 * Catalog edits never touch applied history: the backend froze each applied
 * value at registration time (see backend test_descuentos.py).
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface ActualizarDescuentoBody {
  nombre?: unknown;
  porcentaje?: unknown;
  monto?: unknown;
  activo?: unknown;
}

const UPDATABLE_FIELDS = ["nombre", "porcentaje", "monto", "activo"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { message: "Identificador de descuento inválido." },
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

  const parsed = (typeof body === "object" && body !== null ? body : {}) as ActualizarDescuentoBody;
  const payload: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (parsed[field] !== undefined) payload[field] = parsed[field];
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { message: "No hay campos para actualizar." },
      { status: 400 },
    );
  }

  const result = await backendFetchAuthed(request, `/descuentos/${params.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo actualizar el descuento." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar el descuento.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
