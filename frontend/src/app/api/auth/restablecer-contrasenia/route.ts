import { NextRequest, NextResponse } from "next/server";
import { backendFetch, forwardedForFrom } from "@/lib/server/auth";

interface RestablecerBody {
  token: string;
  nueva_contrasenia: string;
}

function isRestablecerBody(value: unknown): value is RestablecerBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === "string" &&
    v.token.length > 0 &&
    typeof v.nueva_contrasenia === "string" &&
    v.nueva_contrasenia.length >= 8
  );
}

/**
 * POST /api/auth/restablecer-contrasenia — BFF passthrough for
 * POST /auth/restablecer-contrasenia (E01-RF003).
 *
 * Public/unauthenticated — the recovery token itself is the credential
 * here, not a session cookie. Mirrors src/app/api/auth/recuperar-contrasenia
 * route's shape. Consumed by src/services/api.ts's `restablecerContrasenia`,
 * already wired into src/app/reset-password/page.tsx.
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

  if (!isRestablecerBody(body)) {
    return NextResponse.json(
      { error: "invalid_request", message: "El token y la nueva contraseña (mínimo 8 caracteres) son obligatorios." },
      { status: 400 },
    );
  }

  const result = await backendFetch(
    "/auth/restablecer-contrasenia",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.token, nueva_contrasenia: body.nueva_contrasenia }),
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
  if (response.status === 400 || response.status === 401) {
    let message = "El enlace de recuperación es inválido o expiró.";
    try {
      const json = (await response.json()) as { detail?: string; message?: string };
      message = json.detail ?? json.message ?? message;
    } catch {
      // Backend didn't return JSON — keep the default message.
    }
    return NextResponse.json({ error: "invalid_credentials", message }, { status: 400 });
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` },
      { status: 502 },
    );
  }

  // Backend returns 204 No Content on success. The shared client
  // (src/services/api.ts's `request()`) always calls response.json() on a
  // 2xx response, which throws on an empty body — return a small JSON body
  // instead of passing the 204 straight through (same convention as
  // /api/auth/refresh's `{ success: true }`).
  return NextResponse.json({ success: true }, { status: 200 });
}
