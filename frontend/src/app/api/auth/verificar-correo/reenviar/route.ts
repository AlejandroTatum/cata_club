import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { anonymousAuthPost, readRequiredStringFields } from "@/lib/server/bff-helpers";

/**
 * POST /api/auth/verificar-correo/reenviar — BFF passthrough for
 * POST /auth/verificar-correo/reenviar (issue #790).
 *
 * Public/unauthenticated: whoever needs to verify their address may have let
 * their session expire or be opening the link on another device.
 *
 * The backend deliberately returns the same message whether the address is
 * registered or not, and whether or not it is already verified. That message
 * is forwarded as-is — reinterpreting it here would rebuild the enumeration
 * oracle the backend is avoiding.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const [campos, error] = await readRequiredStringFields(
    request,
    ["correo"],
    "El correo electrónico es obligatorio.",
  );
  if (error) return error;

  return anonymousAuthPost("/auth/verificar-correo/reenviar", {
    payload: { correo: campos.correo },
    forwardedFor: forwardedForFrom(request),
  });
}
