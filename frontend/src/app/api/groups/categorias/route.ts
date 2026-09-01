/**
 * BFF proxy — POST /api/groups/categorias
 *
 * Creates a categoria and one horario per día marked, atomically
 * (docs/archive/fixes/24-abm-categorias.md — the owner's own words: "quisiera que
 * se cree directo el horario y categoría, no diferentes"). Proxies to
 * FastAPI's POST /asistencias/categorias, whose `CategoriaCreateDTO` accepts
 * `nombre`, `hora_inicio`, `hora_fin`, `dias` — `codigo` is NOT input, the
 * server derives it from `nombre`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

interface CrearCategoriaBody {
  nombre?: unknown;
  hora_inicio?: unknown;
  hora_fin?: unknown;
  dias?: unknown;
  edades?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as CrearCategoriaBody;
  if (
    typeof body.nombre !== "string" ||
    typeof body.hora_inicio !== "string" ||
    typeof body.hora_fin !== "string" ||
    !Array.isArray(body.dias)
  ) {
    return badRequestResponse("Complete el nombre, la franja y al menos un día.");
  }

  // `edades` (#789) is the only optional field of the create DTO: a categoría
  // with no ages label is valid, so an absent one is left out of the payload
  // entirely rather than sent as null. Type-checked like every other field —
  // this stays an allowlist, not a passthrough.
  const payload: Record<string, unknown> = {
    nombre: body.nombre,
    hora_inicio: body.hora_inicio,
    hora_fin: body.hora_fin,
    dias: body.dias,
  };
  if (typeof body.edades === "string") payload.edades = body.edades;

  return proxyToBackend("/asistencias/categorias", {
    method: "POST",
    accessToken,
    successStatus: 201,
    body: payload,
  });
}
