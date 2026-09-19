/**
 * POST /api/personas/me/representados — issue #1318: a self-managed adult
 * adds their first dependent, and their account switches to REPRESENTANTE
 * in the same request if it isn't already.
 *
 * BFF proxy to FastAPI's `POST /personas/me/representados`. Unlike its
 * sibling `[id]/representados/route.ts` — REPRESENTANTE-only, targets a
 * `persona_id` the caller already owns — this route never carries an id:
 * the backend derives identity from the access token exclusively (same
 * shape as `POST /api/membresias/propia`).
 *
 * The backend can reissue a fresh token pair when it grants REPRESENTANTE:
 * roles travel embedded in the JWT, so without reissuing, the caller's
 * existing session would keep reading its old role until expiry. Same
 * strip-tokens-from-body/rotate-cookies shape `api/auth/correo/route.ts`
 * already uses for the same reason.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { buildRepresentadoBackendBody } from "@/lib/server/bff-helpers";
import type { PersonaResponse } from "@/types/domain";
import type { RepresentadoCreatePayload } from "@/services/api";

interface BackendRepresentadoPropioResponse {
  representado: PersonaResponse;
  accessToken: string;
  refreshToken: string;
}

function isBackendRepresentadoPropioResponse(value: unknown): value is BackendRepresentadoPropioResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.representado === "object" && v.representado !== null &&
    typeof v.accessToken === "string" && v.accessToken.length > 0 &&
    typeof v.refreshToken === "string" && v.refreshToken.length > 0
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: RepresentadoCreatePayload;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as RepresentadoCreatePayload;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, "/personas/me/representados", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRepresentadoBackendBody(body)),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo agregar el dependiente." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo agregar el dependiente.");
  }

  const data: unknown = await result.response.json();
  if (!isBackendRepresentadoPropioResponse(data)) {
    return NextResponse.json(
      { message: "El servidor respondió con una forma inesperada." },
      { status: 502 },
    );
  }

  // Only `{ representado }` ever reaches client JS — tokens live exclusively
  // in the HttpOnly cookies set below.
  const response = NextResponse.json({ representado: data.representado }, { status: 201 });
  setAuthCookies(response, { accessToken: data.accessToken, refreshToken: data.refreshToken });
  return response;
}
