import { NextRequest, NextResponse } from "next/server";
import { backendLogin, backendMe, buildSession, setAuthCookies, type AuthErrorCode } from "@/lib/server/auth";

interface LoginBody {
  email: string;
  password: string;
}

function isLoginBody(value: unknown): value is LoginBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.email === "string" && v.email.length > 0 && typeof v.password === "string" && v.password.length > 0;
}

const ERROR_STATUS: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  // 500, not 503: the server is misconfigured, not overloaded. A 503 invites
  // the client (and any proxy in front of it) to retry a request that can
  // never succeed until a human fixes the deployment.
  config_error: 500,
  backend_unavailable: 503,
  timeout: 503,
  invalid_response: 502,
  unauthorized: 401,
  unknown: 500,
};

/**
 * POST /api/auth/login — BFF login.
 *
 * Accepts the browser's JSON { email, password } (the shape the login form
 * at src/app/login/page.tsx sends), re-encodes it server-side as
 * application/x-www-form-urlencoded { username, password } for FastAPI's
 * OAuth2 password flow, and on success calls /auth/me to build a token-free
 * session. Both tokens are set as HttpOnly cookies here — never returned in
 * the JSON body.
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

  if (!isLoginBody(body)) {
    return NextResponse.json(
      { error: "invalid_request", message: "Correo y contraseña son obligatorios." },
      { status: 400 },
    );
  }

  const loginResult = await backendLogin(body.email, body.password);
  if (!loginResult.ok) {
    return NextResponse.json(
      { error: loginResult.error.code, message: loginResult.error.message },
      { status: ERROR_STATUS[loginResult.error.code] },
    );
  }

  const meResult = await backendMe(loginResult.data.access_token);
  if (!meResult.ok) {
    return NextResponse.json(
      { error: meResult.error.code, message: meResult.error.message },
      { status: ERROR_STATUS[meResult.error.code] },
    );
  }

  const session = buildSession(meResult.data);
  const response = NextResponse.json(session, { status: 200 });
  setAuthCookies(response, {
    accessToken: loginResult.data.access_token,
    refreshToken: loginResult.data.refresh_token,
  });
  return response;
}
