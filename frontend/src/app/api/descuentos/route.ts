/**
 * BFF proxy — GET/POST /api/descuentos (issue #12)
 *
 * GET: full discount catalog, active AND inactive — the admin management
 *      view. Proxies FastAPI's paginated `GET /descuentos/` (issue #814),
 *      forwarding the incoming query string (`skip`/`limit`) as-is — see
 *      `fetchDescuentos` in src/services/api.ts, which requests one page at
 *      the backend's cap.
 * POST: creates a catalog discount. Proxies `POST /descuentos/`, whose
 *       `DescuentoCreateDTO` accepts `nombre`, `porcentaje`, `monto`,
 *       `activo` — same key names in both casings, so no translation.
 *
 * Both endpoints are ADMINISTRADOR-only on the backend (GestorPermisos); a
 * non-admin gets its 403 passed through. Uses `backendFetchAuthed` (not the
 * simpler bff-helpers proxy) so the backend's `detail` domain messages —
 * duplicate name, porcentaje-o-monto exclusivity — reach the form intact.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import {
  backendFetchAuthed,
  passthroughBackendError,
  proxyBackendGet,
} from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBackendGet(
    request, `/descuentos/${request.nextUrl.search}`, "No se pudo cargar el catálogo de descuentos.",
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "JSON inválido en el cuerpo de la solicitud." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).nombre !== "string"
    || (body as Record<string, unknown>).nombre === ""
  ) {
    return NextResponse.json(
      { message: "El nombre del descuento es obligatorio." },
      { status: 400 },
    );
  }

  const payload = body as {
    nombre: string;
    porcentaje?: number | null;
    monto?: number | null;
    activo?: boolean;
  };

  const result = await backendFetchAuthed(request, "/descuentos/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: payload.nombre,
      porcentaje: payload.porcentaje ?? null,
      monto: payload.monto ?? null,
      ...(payload.activo !== undefined ? { activo: payload.activo } : {}),
    }),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo crear el descuento." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo crear el descuento.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
