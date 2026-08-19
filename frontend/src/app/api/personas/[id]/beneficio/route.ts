/**
 * GET    /api/personas/[id]/beneficio — the persona's active club benefit, or null.
 * POST   /api/personas/[id]/beneficio — assign a catalog discount as the benefit.
 * DELETE /api/personas/[id]/beneficio — retire the active benefit.
 *
 * BFF proxy to FastAPI's:
 *   GET/POST/DELETE /personas/{persona_id}/beneficio
 * All three are ADMINISTRADOR-only in the backend (issue #398); the actor
 * (`asignado_por`/`retirado_por`) is derived backend-side from the token,
 * never sent by this route. Backend refusals (403/404/400) are relayed with
 * their own message via `passthroughBackendError`, never flattened to a
 * generic 500.
 *
 * The three handlers share one shape — validate id, proxy, relay error,
 * refresh cookie — so `respondFromProxy` below is the single place that
 * shape lives instead of being repeated per verb. Same reasoning as
 * `patchCatalogResource` in `bff-helpers.ts`, which SonarCloud's duplication
 * gate already caught once when two catalog PATCH routes copied that
 * sequence; this route keeps it local since GET/POST/DELETE of one resource
 * (not another route file) is what repeats it here.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import {
  backendFetchAuthed,
  passthroughBackendError,
  type BackendProxyResult,
} from "@/lib/server/backend-client";

interface RouteContext {
  params: { id: string };
}

function parsePersonaId(id: string): number | null {
  const personaId = Number(id);
  return Number.isNaN(personaId) ? null : personaId;
}

function invalidIdResponse(): NextResponse {
  return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
}

/** Shared tail: relay a proxy/backend failure, or shape the success response and forward a refreshed cookie. */
async function respondFromProxy(
  result: BackendProxyResult,
  fallbackMessage: string,
  successStatus = 200,
): Promise<NextResponse> {
  if (!result.ok) {
    return NextResponse.json({ message: fallbackMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, fallbackMessage);
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: successStatus });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parsePersonaId(context.params.id);
  if (personaId === null) return invalidIdResponse();

  const result = await backendFetchAuthed(request, `/personas/${personaId}/beneficio`, {
    method: "GET",
  });
  return respondFromProxy(result, "No se pudo obtener el beneficio.");
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parsePersonaId(context.params.id);
  if (personaId === null) return invalidIdResponse();

  let descuentoId: number;
  try {
    const raw: unknown = await request.json();
    const value =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).descuentoId
        : undefined;
    if (typeof value !== "number" || Number.isNaN(value)) {
      return NextResponse.json(
        { message: "El descuentoId es obligatorio y debe ser numérico." },
        { status: 400 },
      );
    }
    descuentoId = value;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/beneficio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descuento_id: descuentoId }),
  });
  return respondFromProxy(result, "No se pudo asignar el beneficio.", 201);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parsePersonaId(context.params.id);
  if (personaId === null) return invalidIdResponse();

  const result = await backendFetchAuthed(request, `/personas/${personaId}/beneficio`, {
    method: "DELETE",
  });
  return respondFromProxy(result, "No se pudo retirar el beneficio.");
}
