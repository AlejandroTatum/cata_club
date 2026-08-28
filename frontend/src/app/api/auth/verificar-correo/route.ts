import { NextRequest, NextResponse } from "next/server";
import { forwardedForFrom } from "@/lib/server/auth";
import { anonymousAuthPost } from "@/lib/server/bff-helpers";

interface VerificarBody {
  token: string;
}

function isVerificarBody(value: unknown): value is VerificarBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.token === "string" && v.token.length > 0;
}

/**
 * POST /api/auth/verificar-correo — BFF passthrough for
 * POST /auth/verificar-correo (issue #790).
 *
 * Public/unauthenticated: the verification token that arrived by email IS the
 * credential here, not a session cookie. Arrival is from a mail client, which
 * may well not be the browser the account is signed into.
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

  if (!isVerificarBody(body)) {
    return NextResponse.json(
      { error: "invalid_request", message: "El token de verificación es obligatorio." },
      { status: 400 },
    );
  }

  return anonymousAuthPost("/auth/verificar-correo", {
    payload: { token: body.token },
    forwardedFor: forwardedForFrom(request),
    invalidLinkMessage: "El enlace de verificación es inválido o expiró.",
  });
}
