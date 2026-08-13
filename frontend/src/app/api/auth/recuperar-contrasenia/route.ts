import { NextRequest, NextResponse } from "next/server";
import { backendFetch, forwardedForFrom } from "@/lib/server/auth";

interface RecuperarBody {
  correo: string;
}

function isRecuperarBody(value: unknown): value is RecuperarBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.correo === "string" && v.correo.length > 0;
}

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 },
    );
  }

  if (!isRecuperarBody(body)) {
    return NextResponse.json(
      { error: "invalid_request", message: "El correo electrónico es obligatorio." },
      { status: 400 },
    );
  }

  const result = await backendFetch(
    "/auth/recuperar-contrasenia",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: body.correo }),
    },
    { forwardedFor: forwardedForFrom(request) },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 503 });
  }

  const response = result.data;
  if (response.status === 429) {
    return NextResponse.json(
      { error: "rate_limited", message: "Demasiados intentos. Espere un momento antes de volver a intentarlo." },
      { status: 429 },
    );
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` },
      { status: 502 },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_response", message: "Respuesta del servidor inválida." },
      { status: 502 },
    );
  }

  return NextResponse.json(json, { status: 200 });
}
