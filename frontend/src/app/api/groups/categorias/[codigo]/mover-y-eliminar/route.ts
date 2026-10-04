/**
 * BFF proxy — POST /api/groups/categorias/[codigo]/mover-y-eliminar
 *
 * QA4 ADMB-04: moves ALL players of the categoría to ONE target categoría and
 * deletes it, in a single backend transaction (all or nothing). Proxies to
 * FastAPI's POST /asistencias/categorias/{codigo}/mover-y-eliminar, admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

interface MoverYEliminarBody {
  categoria_destino?: unknown;
}

export async function POST(request: NextRequest, props: { params: Promise<{ codigo: string }> }): Promise<NextResponse> {
  const params = await props.params;
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as MoverYEliminarBody;
  if (typeof body.categoria_destino !== "string" || body.categoria_destino.length === 0) {
    return badRequestResponse("Elige la categoría a la que pasarán los jugadores.");
  }

  return proxyToBackend(`/asistencias/categorias/${encodeURIComponent(params.codigo)}/mover-y-eliminar`, {
    method: "POST",
    accessToken,
    body: { categoria_destino: body.categoria_destino },
  });
}
