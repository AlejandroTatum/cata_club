import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { anonymousAuthPost } from "@/lib/server/bff-helpers";

interface ReenviarBody {
  correo: string;
}

function isReenviarBody(value: unknown): value is ReenviarBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.correo === "string" && v.correo.length > 0;
}

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 },
    );
  }

  if (!isReenviarBody(body)) {
    return NextResponse.json(
      { error: "invalid_request", message: "El correo electrónico es obligatorio." },
      { status: 400 },
    );
  }

  return anonymousAuthPost("/auth/verificar-correo/reenviar", {
    payload: { correo: body.correo },
    forwardedFor: forwardedForFrom(request),
  });
}
