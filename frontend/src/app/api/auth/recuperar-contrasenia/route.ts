import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { anonymousAuthPost, readRequiredStringFields } from "@/lib/server/bff-helpers";

/**
 * POST /api/auth/recuperar-contrasenia — BFF passthrough for
 * POST /auth/recuperar-contrasenia (E01-RF003).
 *
 * Public/unauthenticated, same as /api/auth/login — no cookies read or
 * set here. The backend deliberately returns the same success message
 * whether the email is registered or not (anti-enumeration), so this
 * handler forwards that message as-is rather than reinterpreting it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const [campos, error] = await readRequiredStringFields(
    request,
    ["correo"],
    "El correo electrónico es obligatorio.",
  );
  if (error) return error;

  return anonymousAuthPost("/auth/recuperar-contrasenia", {
    payload: { correo: campos.correo },
    forwardedFor: forwardedForFrom(request),
  });
}
