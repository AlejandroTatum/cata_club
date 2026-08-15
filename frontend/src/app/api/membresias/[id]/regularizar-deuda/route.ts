/**
 * POST /api/membresias/[id]/regularizar-deuda — regularize owed months.
 *
 * BFF proxy to FastAPI's `POST /membresias/{membresia_id}/regularizar-deuda`
 * (issue #284). ADMINISTRADOR-only in the backend: the payment enters APROBADO
 * directly (admin-operated bookkeeping) with explicit retroactive dates and a
 * mandatory motivo. We propagate its 401/403/400/422.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = Number(context.params.id);
  if (Number.isNaN(membresiaId)) {
    return NextResponse.json({ message: "El id de membresía no es válido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/regularizar-deuda`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo registrar la regularización." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar la regularización.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
