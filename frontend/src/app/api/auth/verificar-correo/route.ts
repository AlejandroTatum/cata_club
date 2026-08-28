import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { anonymousAuthPost, readRequiredStringFields } from "@/lib/server/bff-helpers";

/**
 * POST /api/auth/verificar-correo — BFF passthrough for
 * POST /auth/verificar-correo (issue #790).
 *
 * Public/unauthenticated: the verification token that arrived by email IS the
 * credential here, not a session cookie. Arrival is from a mail client, which
 * may well not be the browser the account is signed into.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const [campos, error] = await readRequiredStringFields(
    request,
    ["token"],
    "El token de verificación es obligatorio.",
  );
  if (error) return error;

  return anonymousAuthPost("/auth/verificar-correo", {
    payload: { token: campos.token },
    forwardedFor: forwardedForFrom(request),
    invalidLinkMessage: "El enlace de verificación es inválido o expiró.",
  });
}
