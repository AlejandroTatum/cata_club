/**
 * POST /api/membresias/[id]/cambiar-plan — cambia el tipo de membresía de
 * una membresía YA existente (issue #400, criterio 1).
 *
 * Proxies FastAPI's `POST /membresias/{membresia_id}/cambiar-plan`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). `CambioPlanMembresiaDTO` on the
 * backend is a plain snake_case Pydantic model with NO alias generator
 * (write DTO, not `ResponseBase`) — this handler translates the frontend's
 * camelCase body explicitly, same pattern as `POST /api/membresias/pagos`.
 *
 * Prospectivo (decisión de producto ya tomada, ver
 * `MembresiaServicio.cambiar_plan` en el backend): la cobertura ya pagada no
 * se toca; la tarifa nueva rige recién desde el próximo pago.
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
    || typeof (body as Record<string, unknown>).nuevoTipoMembresiaId !== "number"
  ) {
    return NextResponse.json(
      { message: "El campo nuevoTipoMembresiaId es obligatorio y debe ser numérico." },
      { status: 400 },
    );
  }

  const nuevoTipoMembresiaId = (body as { nuevoTipoMembresiaId: number }).nuevoTipoMembresiaId;

  const result = await backendFetchAuthed(request, `/membresias/${membresiaId}/cambiar-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nuevo_tipo_membresia_id: nuevoTipoMembresiaId }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cambiar el plan de la membresía." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cambiar el plan de la membresía.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
