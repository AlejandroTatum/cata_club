import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import {
  extractAccessToken,
  unauthorizedResponse,
  backendUrl,
  backendTimeout,
  parseJsonResponse,
  extractBackendErrorMessage,
  handleProxyError,
  readRequiredStringFields,
} from "@/lib/server/bff-helpers";

const MENSAJE_CAMPOS_OBLIGATORIOS = "Ingrese su contraseña actual y la nueva contraseña.";

/**
 * POST /api/auth/contrasenia/cambiar — change the signed-in user's password
 * (FAM-17).
 *
 * Same shape as `api/auth/sesiones/invalidar/route.ts`, and for the same
 * reason: the backend revokes the other sessions and reissues a fresh token
 * pair, so the aggregate `proxyToBackend` (which would relay the tokens in the
 * JSON body) is skipped. The tokens become HttpOnly cookies and the body only
 * carries a confirmation message.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [campos, error] = await readRequiredStringFields(
    request,
    ["contrasenia_actual", "nueva_contrasenia"],
    MENSAJE_CAMPOS_OBLIGATORIOS,
  );
  if (error) return error;

  const [controller, done] = backendTimeout();
  try {
    const response = await fetch(backendUrl("/auth/contrasenia/cambiar"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contrasenia_actual: campos.contrasenia_actual,
        nueva_contrasenia: campos.nueva_contrasenia,
      }),
      signal: controller.signal,
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      return NextResponse.json(
        { message: extractBackendErrorMessage(data, response.status) },
        { status: response.status },
      );
    }

    if (!isTokenPairResponse(data)) {
      return NextResponse.json(
        { message: "El servidor respondió con una forma inesperada." },
        { status: 502 },
      );
    }

    const nextResponse = NextResponse.json(
      { mensaje: "Contraseña actualizada. Se cerraron sus otras sesiones; este dispositivo sigue conectado." },
      { status: 200 },
    );
    setAuthCookies(nextResponse, { accessToken: data.access_token, refreshToken: data.refresh_token });
    return nextResponse;
  } catch (error: unknown) {
    return handleProxyError(error);
  } finally {
    done();
  }
}

function isTokenPairResponse(
  value: unknown,
): value is { access_token: string; refresh_token: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" && v.access_token.length > 0 &&
    typeof v.refresh_token === "string" && v.refresh_token.length > 0
  );
}
