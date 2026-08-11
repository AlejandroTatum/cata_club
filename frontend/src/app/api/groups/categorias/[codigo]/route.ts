/**
 * BFF proxy — PUT/DELETE /api/groups/categorias/[codigo]
 *
 * PUT: edits a categoria's nombre/franja/días atomically. FastAPI's
 *      `CategoriaUpdateDTO` accepts `nombre`, `hora_inicio`, `hora_fin`,
 *      `dias`, all optional and applied with `exclude_unset`, so only the
 *      keys present in the incoming body are forwarded — same pattern as
 *      `/api/groups/horarios/[id]`.
 * DELETE: removes the categoria and every one of its horarios. FastAPI
 *      blocks (400) when any of them already has `Asistencia` history.
 * Proxies to FastAPI's PUT/DELETE /asistencias/categorias/{codigo}.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

interface ActualizarCategoriaBody {
  nombre?: unknown;
  hora_inicio?: unknown;
  hora_fin?: unknown;
  dias?: unknown;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { codigo: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as ActualizarCategoriaBody;
  const UPDATABLE_FIELDS: Array<[keyof ActualizarCategoriaBody, string]> = [
    ["nombre", "nombre"],
    ["hora_inicio", "hora_inicio"],
    ["hora_fin", "hora_fin"],
    ["dias", "dias"],
  ];
  const payload: Record<string, unknown> = {};
  for (const [key, field] of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) payload[field] = body[key];
  }

  if (Object.keys(payload).length === 0) {
    return badRequestResponse("No se proporcionaron campos para actualizar.");
  }

  return proxyToBackend(`/asistencias/categorias/${encodeURIComponent(params.codigo)}`, {
    method: "PUT",
    accessToken,
    body: payload,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { codigo: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  return proxyToBackend(`/asistencias/categorias/${encodeURIComponent(params.codigo)}`, {
    method: "DELETE",
    accessToken,
    successStatus: 204,
  });
}
