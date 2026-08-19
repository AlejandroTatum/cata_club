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
 * resolved backend-side). Body validation and the fetch/error/response tail
 * are shared with `.../reactivar/route.ts` via `parseSuspensionReactivacionBody`
 * and `proxyMembresiaAction` (issue #442, round 8).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  parseNumericRouteParam,
  parseSuspensionReactivacionBody,
  proxyMembresiaAction,
} from "@/lib/server/proxy-membresia-action";

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

  const backendBody = parseSuspensionReactivacionBody(body);
  if (!backendBody) {
    return NextResponse.json({ message: "El motivo es obligatorio." }, { status: 400 });
  }

  return proxyMembresiaAction(request, `/membresias/${membresiaId}/suspender`, backendBody, {
    failureMessage: "No se pudo suspender la membresía.",
  });
}
