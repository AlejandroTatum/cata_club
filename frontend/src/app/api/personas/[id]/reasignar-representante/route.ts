/**
 * POST /api/personas/[id]/reasignar-representante — an ADMINISTRADOR
 * replaces a minor's representative, in person at the desk (#1133/#1137).
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/reasignar-representante`.
 * Same shape as the sibling `[id]/independizar/route.ts`: this route does no
 * role check of its own (BFF routes in this repo never do); it forwards
 * whatever 401/403/400/404/409/422 the backend answers, so the caller sees
 * the backend's own wording verbatim (stale-state 409, domain-rule 422).
 *
 * `Idempotency-Key` is required by the backend command (a retry with the
 * SAME key replays the already-committed result instead of running it
 * twice) — this route forwards the caller's header verbatim, or mints one
 * when absent so a client that forgot it still gets a safe request.
 *
 * `ReasignacionResponseDTO` (backend) is a plain `BaseModel` (not
 * `ResponseBase`), so the backend answers snake_case — this route translates
 * it into the frontend's camelCase `ReasignacionResponse`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";
import type { ReasignacionResponse } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface BackendReasignacionResponse {
  persona_id: number;
  representante_anterior_id: number | null;
  representante_nuevo_id: number;
  replay: boolean;
  idempotency_key: string;
}

const CAMPOS_OBLIGATORIOS_MENSAJE =
  "El nuevo representante, el representante actual y la evidencia del trámite son obligatorios.";

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  let body: {
    nuevoRepresentanteId?: unknown;
    representanteActualId?: unknown;
    evidenciaIdentidad?: unknown;
  };
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as typeof body;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (
    typeof body.nuevoRepresentanteId !== "number" ||
    typeof body.representanteActualId !== "number" ||
    typeof body.evidenciaIdentidad !== "string" || !body.evidenciaIdentidad
  ) {
    return NextResponse.json({ message: CAMPOS_OBLIGATORIOS_MENSAJE }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key") || crypto.randomUUID();

  const result = await backendFetchAuthed(request, `/personas/${personaId}/reasignar-representante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      nuevo_representante_id: body.nuevoRepresentanteId,
      representante_actual_id: body.representanteActualId,
      evidencia_identidad: body.evidenciaIdentidad,
    }),
  });

  const fallback = "No se pudo reasignar el representante de esta persona.";
  if (!result.ok) {
    return NextResponse.json({ message: fallback }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, fallback);
  }

  const backendData = (await result.response.json()) as BackendReasignacionResponse;
  const data: ReasignacionResponse = {
    personaId: backendData.persona_id,
    representanteAnteriorId: backendData.representante_anterior_id,
    representanteNuevoId: backendData.representante_nuevo_id,
    replay: backendData.replay,
    idempotencyKey: backendData.idempotency_key,
  };
  const response = NextResponse.json(data, { status: 200 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
