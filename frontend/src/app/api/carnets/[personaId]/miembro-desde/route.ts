/**
 * PATCH /api/carnets/[personaId]/miembro-desde — the admin sets or clears one
 * player's «Miembro desde» (issue #1749).
 *
 * The browser sends the month it picked as `{ miembroDesde: "YYYY-MM" }`, or
 * `{ miembroDesde: null }` to clear it; the backend gets the first day of that
 * month (`PATCH /personas/{id}/miembro-desde`). The backend is the authority:
 * the endpoint is ADMINISTRADOR-only, and "not in the future", "not before the
 * club's founding" and "only players" are checked there, so its refusal is
 * relayed as it is written for the admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { badRequestResponse, parseJsonBody } from "@/lib/server/bff-helpers";

const FAILURE_MESSAGE = "No se pudo guardar «Miembro desde».";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function PATCH(request: NextRequest, props: { params: Promise<{ personaId: string }> }): Promise<NextResponse> {
  const { personaId } = await props.params;
  if (!/^\d+$/.test(personaId) || Number(personaId) <= 0) {
    return badRequestResponse("Identificador de jugador inválido.");
  }

  const [body, parseError] = await parseJsonBody(request);
  if (parseError) return parseError;
  const month = (body as { miembroDesde?: unknown } | null)?.miembroDesde;
  if (month !== null && !(typeof month === "string" && MONTH_PATTERN.test(month))) {
    return badRequestResponse("Elige un mes y un año.");
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/miembro-desde`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ miembro_desde: month === null ? null : `${month}-01` }),
  });
  if (!result.ok) {
    return NextResponse.json({ message: FAILURE_MESSAGE }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, FAILURE_MESSAGE);
  }

  const persona = (await result.response.json()) as { miembroDesde?: string | null };
  const response = NextResponse.json({ miembroDesde: persona.miembroDesde ?? null });
  if (result.refreshedAccessToken) setAuthCookies(response, refreshedTokenCookies(result));
  return response;
}
