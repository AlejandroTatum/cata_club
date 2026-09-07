/**
 * PATCH /api/personas/[id]/cuenta/estado — activate or deactivate an account.
 *
 * BFF proxy to FastAPI's `PATCH /personas/{persona_id}/cuenta/estado`.
 * ADMINISTRADOR-only in the backend; we propagate its 401/403.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";
import type { RolesResponse } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface StateBody {
  activo: boolean;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  let body: StateBody;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as StateBody;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/cuenta/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activo: body.activo }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cambiar el estado de la cuenta." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cambiar el estado de la cuenta.");
  }

  const data = (await result.response.json()) as RolesResponse;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
