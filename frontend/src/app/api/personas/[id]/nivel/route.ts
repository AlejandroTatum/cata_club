/**
 * PATCH /api/personas/[id]/nivel — put a student on a level, or take them off.
 *
 * BFF proxy to FastAPI's `PATCH /personas/{persona_id}/nivel`. ADMINISTRADOR
 * and ENTRENADOR in the backend; we propagate its 401/403.
 *
 * REPLACES `POST /api/groups/assign` and `PATCH /api/groups/move`. Those two
 * existed because the backend had two endpoints — one that refused a student
 * who already held a level, one that refused a student who did not — so the
 * UI had to know which of the three data states (no `Ranking` row, row with a
 * NULL level, row with a level) the student was in before it could pick a
 * verb. The backend operation is idempotent now, so there is one route here.
 *
 * `nivelRankingId: null` is the unassign instruction, and it is meaningful:
 * `assign`'s and `move`'s doc comments both recorded that no way to unassign a
 * student existed at all. The field is required precisely so that `{}` cannot
 * silently mean "leave it alone" on one side and "clear it" on the other.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface RouteContext {
  params: { id: string };
}

interface NivelRequestBody {
  nivelRankingId?: unknown;
}

const ERROR_MESSAGE = "No se pudo asignar el nivel del estudiante.";

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (!Number.isInteger(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud" }, { status: 400 });
  }
  if (typeof rawBody !== "object" || rawBody === null) {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const body = rawBody as NivelRequestBody;
  const nivelRankingId = body.nivelRankingId;
  // Explicit allowlist, and `null` is a value rather than an absence: only a
  // number or a literal null gets through, and nothing else in the body is
  // forwarded.
  if (!(typeof nivelRankingId === "number" || nivelRankingId === null)) {
    return NextResponse.json(
      { message: "nivelRankingId es obligatorio: un número, o null para quitar el nivel." },
      { status: 400 },
    );
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/nivel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nivel_ranking_id: nivelRankingId }),
  });
  if (!result.ok) {
    return NextResponse.json({ message: ERROR_MESSAGE }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, ERROR_MESSAGE);
  }

  const item = await result.response.json();
  const response = NextResponse.json(item);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
