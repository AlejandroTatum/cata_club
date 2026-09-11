/**
 * POST /api/personas/[id]/independizar — an ADMINISTRADOR ends a represented
 * person's link to their representative, in person at the desk (#1137).
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/independizar`. The
 * old self-service version of this endpoint (a minor-turned-adult confirming
 * their own password) is gone: the backend now requires the ADMINISTRADOR
 * role and a presencial `IndependizarDTO` (`correo`, `contrasenia`,
 * `evidencia_identidad`) — see the router's own doc comment in
 * `backend/app/presentacion/routers/personas_router.py`. This route does no
 * role check of its own (BFF routes in this repo never do); it forwards
 * whatever 401/403/400/409/422 the backend answers.
 *
 * `Idempotency-Key` is required by the backend command (a retry with the
 * SAME key replays the already-committed result instead of running it
 * twice) — this route forwards the caller's header verbatim, or mints one
 * when absent so a client that forgot it still gets a safe request.
 *
 * `IndependenciaResponseDTO` is a plain `BaseModel` (not `ResponseBase`), so
 * the backend answers snake_case — this route translates it into the
 * frontend's camelCase `IndependenciaResponse`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";
import type { IndependenciaResponse } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface BackendIndependenciaResponse {
  persona_id: number;
  representante_anterior_id: number | null;
  usuario_id: number | null;
  cuenta_creada: boolean;
  replay: boolean;
  idempotency_key: string;
}

const CAMPOS_OBLIGATORIOS_MENSAJE =
  "El correo, la contraseña y la evidencia del trámite son obligatorios.";

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  let body: { correo?: unknown; contrasenia?: unknown; evidenciaIdentidad?: unknown };
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
    typeof body.correo !== "string" || !body.correo ||
    typeof body.contrasenia !== "string" || !body.contrasenia ||
    typeof body.evidenciaIdentidad !== "string" || !body.evidenciaIdentidad
  ) {
    return NextResponse.json({ message: CAMPOS_OBLIGATORIOS_MENSAJE }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key") || crypto.randomUUID();

  const result = await backendFetchAuthed(request, `/personas/${personaId}/independizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      correo: body.correo,
      contrasenia: body.contrasenia,
      evidencia_identidad: body.evidenciaIdentidad,
    }),
  });

  const fallback = "No se pudo completar la independencia de esta persona.";
  if (!result.ok) {
    return NextResponse.json({ message: fallback }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, fallback);
  }

  const backendData = (await result.response.json()) as BackendIndependenciaResponse;
  const data: IndependenciaResponse = {
    personaId: backendData.persona_id,
    representanteAnteriorId: backendData.representante_anterior_id,
    usuarioId: backendData.usuario_id,
    cuentaCreada: backendData.cuenta_creada,
    replay: backendData.replay,
    idempotencyKey: backendData.idempotency_key,
  };
  const response = NextResponse.json(data, { status: 200 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
