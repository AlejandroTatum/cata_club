/**
 * BFF proxy — POST /api/groups/categorias/[codigo]/mover-alumnos
 *
 * QA4 ADMB-04: moves the chosen players (one by one) from the categoría to a
 * target categoría, without deleting anything. Proxies to FastAPI's
 * POST /asistencias/categorias/{codigo}/mover-alumnos, admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

interface MoverAlumnosBody {
  categoria_destino?: unknown;
  persona_ids?: unknown;
}

export async function POST(request: NextRequest, props: { params: Promise<{ codigo: string }> }): Promise<NextResponse> {
  const params = await props.params;
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as MoverAlumnosBody;
  if (typeof body.categoria_destino !== "string" || body.categoria_destino.length === 0) {
    return badRequestResponse("Elige la categoría a la que pasarán los jugadores.");
  }
  if (
    !Array.isArray(body.persona_ids) ||
    body.persona_ids.length === 0 ||
    !body.persona_ids.every((id) => typeof id === "number")
  ) {
    return badRequestResponse("Elige al menos un jugador.");
  }

  return proxyToBackend(`/asistencias/categorias/${encodeURIComponent(params.codigo)}/mover-alumnos`, {
    method: "POST",
    accessToken,
    body: { categoria_destino: body.categoria_destino, persona_ids: body.persona_ids },
  });
}
