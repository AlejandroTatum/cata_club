/**
 * BFF proxy — PUT/DELETE /api/groups/horarios/[id]
 *
 * PUT: updates a training schedule. FastAPI's `HorarioUpdateDTO` accepts
 *      exactly `categoria`, `dia_semana` and `entrenador_id`, all optional
 *      and applied with `exclude_unset`, so only the keys present in the
 *      incoming body are forwarded.
 * DELETE: removes a training schedule.
 * Proxies to FastAPI's PUT/DELETE /asistencias/horarios/{id}.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  parseJsonBody,
  parseJsonResponse,
  extractBackendErrorMessage,
  handleProxyError,
  backendTimeout,
  backendUrl,
  unauthorizedResponse,
  badRequestResponse,
} from "@/lib/server/bff-helpers";

/** `hora_inicio`/`hora_fin` are absent on purpose: the backend derives them
 *  server-side from `CATEGORIA_METADATA[categoria]`, so they are not input.
 *  `nivel_ranking_id` is not part of the schedule either — ranking level lives
 *  on `Ranking`. Forwarding any of them makes FastAPI reject the request. */
interface ActualizarHorarioBody {
  categoria?: unknown;
  dia_semana?: unknown;
  entrenador_id?: unknown;
}

function buildBackendUrl(id: string): string {
  return backendUrl(`/asistencias/horarios/${encodeURIComponent(id)}`);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as ActualizarHorarioBody;
  const UPDATABLE_FIELDS: Array<[keyof ActualizarHorarioBody, string]> = [
    ["categoria", "categoria"],
    ["dia_semana", "dia_semana"],
    ["entrenador_id", "entrenador_id"],
  ];
  const payload: Record<string, unknown> = {};
  for (const [key, field] of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) payload[field] = body[key];
  }

  if (Object.keys(payload).length === 0) {
    return badRequestResponse("No se proporcionaron campos para actualizar.");
  }

  const [controller, done] = backendTimeout();
  try {
    const response = await fetch(buildBackendUrl(params.id), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      return NextResponse.json(
        { message: extractBackendErrorMessage(data, response.status) },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error: unknown) {
    return handleProxyError(error);
  } finally {
    done();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [controller, done] = backendTimeout();
  try {
    const response = await fetch(buildBackendUrl(params.id), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await parseJsonResponse(response);
      return NextResponse.json(
        { message: extractBackendErrorMessage(data, response.status) },
        { status: response.status },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    return handleProxyError(error);
  } finally {
    done();
  }
}
