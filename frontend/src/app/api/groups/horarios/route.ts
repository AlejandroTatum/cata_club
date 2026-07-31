/**
 * BFF proxy — GET/POST /api/groups/horarios
 *
 * GET: lists training schedules (optionally filtered by `?categoria=`).
 *      Proxies to FastAPI's GET /asistencias/horarios.
 * POST: creates a new training schedule. Proxies to FastAPI's
 *       POST /asistencias/horarios, whose `HorarioCreateDTO` accepts exactly
 *       `categoria` and `dia_semana` (no trainer — issue #13).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

/** `hora_inicio`/`hora_fin` are absent on purpose: the backend derives them
 *  server-side from `CATEGORIA_METADATA[categoria]`, so they are not input.
 *  `nivel_ranking_id` is not part of the schedule either — ranking level lives
 *  on `Ranking`. Forwarding any of them makes FastAPI reject the request. */
interface CrearHorarioBody {
  categoria?: unknown;
  dia_semana?: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const categoria = request.nextUrl.searchParams.get("categoria");
  const query = categoria ? `?categoria=${encodeURIComponent(categoria)}` : "";

  return proxyToBackend(`/asistencias/horarios${query}`, { method: "GET", accessToken });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as CrearHorarioBody;
  if (typeof body.categoria !== "string" || typeof body.dia_semana !== "string") {
    return badRequestResponse("Seleccione la categoría y el día.");
  }

  return proxyToBackend("/asistencias/horarios", {
    method: "POST",
    accessToken,
    successStatus: 201,
    body: {
      categoria: body.categoria,
      dia_semana: body.dia_semana,
    },
  });
}
