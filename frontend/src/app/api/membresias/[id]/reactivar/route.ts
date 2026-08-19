/**
 * POST /api/membresias/[id]/reactivar — reactiva una membresía SUSPENDIDA
 * (issue #400, criterio 3).
 *
 * Proxies FastAPI's `POST /membresias/{membresia_id}/reactivar`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). Same body shape and same
 * camelCase-to-snake_case translation as `.../suspender/route.ts` —
 * `SuspensionReactivacionDTO` is shared by both operations backend-side,
 * so both routes share `parseSuspensionReactivacionBody` and
 * `proxyMembresiaAction` (issue #442, round 8).
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

  return proxyMembresiaAction(request, `/membresias/${membresiaId}/reactivar`, backendBody, {
    failureMessage: "No se pudo reactivar la membresía.",
  });
}
