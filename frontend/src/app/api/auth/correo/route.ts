/**
 * PATCH /api/auth/correo — correct the address of an unverified account
 * (issue #1245).
 *
 * BFF passthrough for `PATCH /auth/correo`
 * (`AuthServicio.cambiar_correo_no_verificado`). AUTHENTICATED, unlike its
 * `/auth/verificar-correo/*` siblings (`reenviar`/`route.ts` above): this
 * call needs the caller's own identity, resolved from the access-token
 * cookie via `backendFetchAuthed` — the backend only lets a caller correct
 * THEIR OWN address, and only while it is still unverified.
 *
 * The backend's `sub` claim IS the correo, so a successful change reissues a
 * fresh token pair pointing at the new address (see
 * `CambiarCorreoNoVerificadoResponseDTO`'s doc comment). Same
 * strip-tokens-from-body/rotate-cookies shape `api/auth/me/route.ts`'s
 * `PATCH` already uses for its own (now dormant) correo-change path — tokens
 * never reach the JSON body, only HttpOnly cookies via `setAuthCookies`.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { readRequiredStringFields } from "@/lib/server/bff-helpers";

interface BackendCambiarCorreoResponse {
  correo: string;
  mensaje: string;
  accessToken: string;
  refreshToken: string;
}

function isCambiarCorreoResponse(value: unknown): value is BackendCambiarCorreoResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.correo === "string" && v.correo.length > 0 &&
    typeof v.mensaje === "string" && v.mensaje.length > 0 &&
    typeof v.accessToken === "string" && v.accessToken.length > 0 &&
    typeof v.refreshToken === "string" && v.refreshToken.length > 0
  );
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const [campos, error] = await readRequiredStringFields(
    request,
    ["correo"],
    "El correo electrónico es obligatorio.",
  );
  if (error) return error;

  const result = await backendFetchAuthed(request, "/auth/correo", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo: campos.correo }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo corregir el correo." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo corregir el correo.");
  }

  const data: unknown = await result.response.json();
  if (!isCambiarCorreoResponse(data)) {
    return NextResponse.json(
      { message: "El servidor respondió con una forma inesperada." },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ correo: data.correo, mensaje: data.mensaje });
  setAuthCookies(response, { accessToken: data.accessToken, refreshToken: data.refreshToken });
  return response;
}
