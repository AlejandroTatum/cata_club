/**
 * POST /api/membresias/[id]/suspender — suspende una membresía ACTIVA
 * (issue #400, criterio 3).
 *
 * Proxies FastAPI's `POST /membresias/{membresia_id}/suspender`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). `SuspensionReactivacionDTO` on
 * the backend is a plain snake_case Pydantic model with NO alias generator
 * (write DTO, not `ResponseBase`) — this handler translates the frontend's
 * camelCase body explicitly, same pattern as `POST /api/membresias/pagos`.
 * `motivo` is mandatory; `fechaEfectiva` is optional (omitted means "now",
 * resolved backend-side).
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
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).motivo !== "string"
    || (body as Record<string, unknown>).motivo === ""
  ) {
    return NextResponse.json({ message: "El motivo es obligatorio." }, { status: 400 });
  }

  const payload = body as { motivo: string; fechaEfectiva?: unknown };
  const backendBody: Record<string, unknown> = { motivo: payload.motivo };
  if (payload.fechaEfectiva !== undefined) backendBody.fecha_efectiva = payload.fechaEfectiva;

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/suspender`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo suspender la membresía." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo suspender la membresía.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
