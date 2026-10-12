import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { readRequiredStringFields } from "@/lib/server/bff-helpers";

const MENSAJE_CAMPOS_OBLIGATORIOS = "Ingresa tu contraseña.";

/**
 * POST /api/auth/reautenticar — password step-up for role changes (#1653, S5).
 *
 * Proxies `POST /auth/reautenticar`. The backend marks the CURRENT session as
 * freshly re-authenticated for 10 minutes; nothing is stored here and the
 * password is forwarded once, never logged or echoed.
 *
 * A wrong password is a backend 401 (`codigo: contrasenia_incorrecta`). It is
 * relayed as a 400 instead: the browser client treats any 401 as an expired
 * session and refreshes (and may sign the user out), which a typo must not do.
 * For the same reason the 401 is not replayed here (`retryOnUnauthorized`): a
 * second attempt would count twice toward the account's login lockout.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const [campos, error] = await readRequiredStringFields(request, ["contrasenia"], MENSAJE_CAMPOS_OBLIGATORIOS);
  if (error) return error;

  const result = await backendFetchAuthed(
    request,
    "/auth/reautenticar",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrasenia: campos.contrasenia }),
    },
    { retryOnUnauthorized: false },
  );

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo confirmar tu contraseña." }, { status: result.status });
  }
  if (!result.response.ok) {
    const relayed = await passthroughBackendError(result.response.clone(), "No se pudo confirmar tu contraseña.");
    const body = (await relayed.clone().json()) as { codigo?: string };
    if (result.response.status === 401 && body.codigo === "contrasenia_incorrecta") {
      return NextResponse.json(
        { message: "Contraseña incorrecta", mensaje_seguro: true, codigo: body.codigo },
        { status: 400 },
      );
    }
    return relayed;
  }

  const data = (await result.response.json()) as { reautenticado_hasta: string };
  const response = NextResponse.json({ reautenticadoHasta: data.reautenticado_hasta });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}
