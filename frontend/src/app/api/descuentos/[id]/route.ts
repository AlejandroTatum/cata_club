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
import { patchCatalogResource } from "@/lib/server/bff-helpers";

const UPDATABLE_FIELDS = ["nombre", "porcentaje", "monto", "activo"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return patchCatalogResource(request, {
    id: params.id,
    buildPath: (id) => `/descuentos/${id}`,
    updatableFields: UPDATABLE_FIELDS,
    invalidIdMessage: "Identificador de descuento inválido.",
    failureMessage: "No se pudo actualizar el descuento.",
  });
}
