/**
 * Shared plumbing for the `membresias` action routes
 * (`[id]/reactivar`, `[id]/suspender`, `[id]/cambiar-plan`,
 * `pagos/[pagoId]/corregir`) — extracted after SonarCloud flagged ~95%
 * byte-identical duplication across these four handlers (issue #442, round
 * 8). Each route still owns its own body validation/translation; only the
 * id-parsing and fetch/error/response tail are common.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

/**
 * Parse a route param expected to be numeric (`membresiaId`, `pagoId`, ...).
 * `requireInteger` mirrors each route's original validator exactly:
 * `reactivar`/`suspender`/`cambiar-plan` only ever checked `Number.isNaN`
 * (so `"12.5"` was accepted), while `corregir` used `Number.isInteger`.
 * Returns the parsed number, or the 400 `NextResponse` the caller should
 * return as-is.
 */
export function parseNumericRouteParam(
  value: string,
  label: string,
  options: { requireInteger?: boolean } = {},
): number | NextResponse {
  const parsed = Number(value);
  const isValid = options.requireInteger ? Number.isInteger(parsed) : !Number.isNaN(parsed);
  if (!isValid) {
    return NextResponse.json({ message: `El id de ${label} no es válido.` }, { status: 400 });
  }
  return parsed;
}

/**
 * Shared body validation for `reactivar`/`suspender` — both proxy the same
 * backend `SuspensionReactivacionDTO`: `motivo` mandatory non-empty string,
 * `fechaEfectiva` optional (omitted means "now", resolved backend-side).
 * Returns `null` when invalid so the caller emits its own 400.
 */
export function parseSuspensionReactivacionBody(body: unknown): { motivo: string; fecha_efectiva?: unknown } | null {
  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).motivo !== "string"
    || (body as Record<string, unknown>).motivo === ""
  ) {
    return null;
  }

  const payload = body as { motivo: string; fechaEfectiva?: unknown };
  const backendBody: { motivo: string; fecha_efectiva?: unknown } = { motivo: payload.motivo };
  if (payload.fechaEfectiva !== undefined) backendBody.fecha_efectiva = payload.fechaEfectiva;
  return backendBody;
}

/**
 * The fetch/error/response tail every `membresias` action route repeats:
 * authenticated POST to `backendPath`, translate a proxy failure or a
 * non-OK backend response into `opts.failureMessage`, otherwise relay the
 * backend JSON body with `opts.successStatus` (default 200) and forward a
 * refreshed access-token cookie.
 */
export async function proxyMembresiaAction(
  request: NextRequest,
  backendPath: string,
  backendBody: Record<string, unknown>,
  opts: { failureMessage: string; successStatus?: number },
): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, backendPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: opts.failureMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, opts.failureMessage);
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: opts.successStatus ?? 200 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
