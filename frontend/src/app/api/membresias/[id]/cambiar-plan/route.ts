/**
 * POST /api/membresias/[id]/cambiar-plan — cambia el tipo de membresía de
 * una membresía YA existente (issue #400, criterio 1).
 *
 * Proxies FastAPI's `POST /membresias/{membresia_id}/cambiar-plan`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). `CambioPlanMembresiaDTO` on the
 * backend is a plain snake_case Pydantic model with NO alias generator
 * (write DTO, not `ResponseBase`) — this handler translates the frontend's
 * camelCase body explicitly, same pattern as `POST /api/membresias/pagos`.
 * The id-parsing and fetch/error/response tail are shared with the other
 * `membresias` action routes via `proxyMembresiaAction` (issue #442,
 * round 8).
 *
 * Prospectivo (decisión de producto ya tomada, ver
 * `MembresiaServicio.cambiar_plan` en el backend): la cobertura ya pagada no
 * se toca; la tarifa nueva rige recién desde el próximo pago.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseNumericRouteParam, proxyMembresiaAction } from "@/lib/server/proxy-membresia-action";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = parseNumericRouteParam(context.params.id, "membresía");
  if (membresiaId instanceof NextResponse) return membresiaId;

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

  return proxyMembresiaAction(
    request,
    `/membresias/${membresiaId}/cambiar-plan`,
    { nuevo_tipo_membresia_id: nuevoTipoMembresiaId },
    { failureMessage: "No se pudo cambiar el plan de la membresía." },
  );
}
