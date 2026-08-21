/**
 * GET/POST /api/membresias/tipos — membership type catalog.
 *
 * GET: list the catalog. Proxies FastAPI's GET /membresias/tipos (any
 *      authenticated user).
 * POST: create a catalog tariff (issue #507). Proxies FastAPI's
 *       POST /membresias/tipos (`TipoMembresiaCreateDTO` — admin-only,
 *       `GestorPermisos(["ADMINISTRADOR"])` on the backend; a non-admin gets
 *       its 403 passed through). Uses the shared `postCatalogResource` —
 *       same proxy/timeout/error shaping as the PATCH sibling in
 *       `tipos/[id]/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { postCatalogResource } from "@/lib/server/bff-helpers";

const REQUIRED_FIELDS = ["categoria", "precio", "modalidad"] as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  return postCatalogResource(request, {
    backendPath: "/membresias/tipos",
    requiredFields: REQUIRED_FIELDS,
    missingFieldMessage: "Categoría, precio y modalidad son obligatorios.",
    failureMessage: "No se pudo crear la tarifa.",
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/membresias/tipos");

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudieron cargar los tipos de membresía." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar los tipos de membresía.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
