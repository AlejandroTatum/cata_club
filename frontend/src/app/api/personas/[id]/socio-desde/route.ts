/**
 * PUT /api/personas/[id]/socio-desde — admin sets the person's real «Socio
 * desde» date (the «Jugador desde» a student sees).
 *
 * BFF proxy to FastAPI's `PUT /personas/{persona_id}/socio-desde`
 * (ADMINISTRADOR-only; a future date is a 422 whose Spanish message
 * `passthroughBackendError` relays). `SocioDesdeUpdateDTO` is a plain
 * snake_case write DTO, so the camelCase body is translated here. The
 * fetch/error/response tail is the shared `proxyMembresiaAction`.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseNumericRouteParam, proxyMembresiaAction } from "@/lib/server/proxy-membresia-action";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericRouteParam((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }
  const fecha = typeof body === "object" && body !== null ? (body as Record<string, unknown>).fechaInicioClub : undefined;
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ message: "Ingresa una fecha válida." }, { status: 400 });
  }

  return proxyMembresiaAction(
    request,
    `/personas/${personaId}/socio-desde`,
    { fecha_inicio_club: fecha },
    { failureMessage: "No se pudo guardar la fecha de socio.", method: "PUT" },
  );
}
