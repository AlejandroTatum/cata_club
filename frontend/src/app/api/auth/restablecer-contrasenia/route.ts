import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import {
  anonymousAuthPost,
  badRequestResponse,
  readRequiredStringFields,
} from "@/lib/server/bff-helpers";

/** The backend's only constraint: `nueva_contrasenia: str = Field(..., min_length=8)`. */
const LONGITUD_MINIMA_CONTRASENIA = 8;

const MENSAJE_CAMPOS_OBLIGATORIOS =
  "El token y la nueva contraseña (mínimo 8 caracteres) son obligatorios.";

/**
 * POST /api/auth/restablecer-contrasenia — BFF passthrough for
 * POST /auth/restablecer-contrasenia (E01-RF003).
 *
 * Public/unauthenticated — the recovery token itself is the credential
 * here, not a session cookie. Consumed by src/services/api.ts's
 * `restablecerContrasenia`, wired into src/app/reset-password/page.tsx.
 *
 * The password-length rule stays HERE rather than moving into the shared
 * helper: it is this endpoint's own contract with the backend, and a reader
 * looking for "what does reset refuse?" should find the answer next to the
 * route, not inside a generic utility.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Issue #1575: only a trainer's invitation link asks for the terms
  // acceptance; the flag is forwarded as-is and ignored by an ordinary reset.
  const acceptsTerms = await request
    .clone()
    .json()
    .then(
      (body: unknown) =>
        typeof body === "object" && body !== null && (body as { acepta_terminos?: unknown }).acepta_terminos === true,
      () => false,
    );

  const [campos, error] = await readRequiredStringFields(
    request,
    ["token", "nueva_contrasenia"],
    MENSAJE_CAMPOS_OBLIGATORIOS,
  );
  if (error) return error;

  if (campos.nueva_contrasenia.length < LONGITUD_MINIMA_CONTRASENIA) {
    return badRequestResponse(MENSAJE_CAMPOS_OBLIGATORIOS);
  }

  return anonymousAuthPost("/auth/restablecer-contrasenia", {
    payload: {
      token: campos.token,
      nueva_contrasenia: campos.nueva_contrasenia,
      ...(acceptsTerms ? { acepta_terminos: true } : {}),
    },
    forwardedFor: forwardedForFrom(request),
    invalidLinkMessage: "El enlace de recuperación es inválido o expiró.",
  });
}
