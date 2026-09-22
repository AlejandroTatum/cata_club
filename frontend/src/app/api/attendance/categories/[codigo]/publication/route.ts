/**
 * PATCH /api/attendance/categories/[codigo]/publication — publish/hide a
 * categoría on the public landing.
 *
 * BFF proxy to FastAPI's `PATCH /asistencias/categorias/{codigo}/publicacion`
 * (ADMIN-only there). The body is exactly one boolean — `visible` — the
 * admin toggle's whole contract: hiding is a publication decision, never a
 * data change, so this deliberately does NOT go through the atomic
 * nombre/franja/días edit (`PUT /api/groups/categorias/[codigo]`).
 *
 * Proxies the backend's `CategoriaResponseDTO` response verbatim on success
 * and relays its 404/403 the same way the sibling catalog routes do.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

interface PublicacionBody {
  visible?: unknown;
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ codigo: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const visible = (rawBody as PublicacionBody).visible;
  // Exactly one boolean, validated here rather than forwarded blind: the
  // backend's `CategoriaPublicacionDTO` would 422 a non-boolean with a raw
  // pydantic payload the UI can't show.
  if (typeof visible !== "boolean") {
    return badRequestResponse("El campo 'visible' es obligatorio y debe ser booleano.");
  }

  return proxyToBackend(
    `/asistencias/categorias/${encodeURIComponent(params.codigo)}/publicacion`,
    { method: "PATCH", accessToken, body: { visible } },
  );
}
