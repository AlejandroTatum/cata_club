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
import { patchCatalogResource } from "@/lib/server/bff-helpers";

const UPDATABLE_FIELDS = ["categoria", "precio", "modalidad"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return patchCatalogResource(request, {
    id: params.id,
    buildPath: (id) => `/membresias/tipos/${id}`,
    updatableFields: UPDATABLE_FIELDS,
    invalidIdMessage: "Identificador de tipo de membresía inválido.",
    failureMessage: "No se pudo actualizar la tarifa.",
  });
}
