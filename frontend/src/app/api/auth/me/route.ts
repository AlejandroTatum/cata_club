/**
 * GET /api/auth/me — fetch the logged-in user's own profile (Issue #36).
 * PATCH /api/auth/me — update the logged-in user's own telefono.
 *
 * BFF proxies to FastAPI's:
 *   GET /auth/me (now includes telefono, fechaCreacion)
 *   PATCH /auth/me (self-service, any authenticated role — no admin gate)
 *
 * `fechaCreacion` requires no explicit mapping here: the backend's camelCase
 * alias generator (`ResponseBase`) already produces it, and both handlers
 * below pass the backend JSON through unmodified (aside from stripping
 * tokens on PATCH) — see route.test.ts for the passthrough confirmation.
 *
 * Deliberately separate from `/api/auth/session` and `backendMe`/`buildSession`
 * (see `src/lib/server/auth.ts`) — this route is the dedicated "self profile"
 * fetch/mutate path consumed only by `PerfilPropio` (src/types/domain.ts),
 * not the global session used by AuthContext/nav/ProtectedRoute.
 *
 * Correo is intentionally never accepted here — it's the JWT `sub` claim,
 * and self-service editing was removed by design (see auth_servicio.py). The
 * accessToken/refreshToken stripping below is defensive leftover from when
 * correo changes reissued tokens; kept in case the backend response shape
 * ever carries them again, but is a no-op in practice now.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PerfilPropio } from "@/types/domain";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/auth/me");

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar el perfil." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar el perfil.");
  }

  const data = (await result.response.json()) as PerfilPropio;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}

interface PatchBody {
  telefono?: string;
}

/** Raw shape of the backend's PATCH /auth/me response — tokens present only when correo changed. */
interface BackendActualizarPerfilResponse extends PerfilPropio {
  accessToken?: string;
  refreshToken?: string;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: PatchBody;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as PatchBody;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const backendBody: Record<string, unknown> = {};
  if (body.telefono !== undefined) backendBody.telefono = body.telefono;

  const result = await backendFetchAuthed(request, "/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo actualizar el perfil." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar el perfil.");
  }

  const data = (await result.response.json()) as BackendActualizarPerfilResponse;
  const { accessToken, refreshToken, ...perfil } = data;

  const response = NextResponse.json(perfil satisfies PerfilPropio);

  if (accessToken) {
    // Correo changed — backend reissued the token pair. Rotate cookies now,
    // tokens are already stripped from `perfil` above.
    setAuthCookies(response, { accessToken, refreshToken });
  } else if (result.refreshedAccessToken) {
    // No correo change, but backendFetchAuthed's own proactive/retry refresh
    // rotated the caller's access token — persist that instead.
    setAuthCookies(response, refreshedTokenCookies(result));
  }

  return response;
}
