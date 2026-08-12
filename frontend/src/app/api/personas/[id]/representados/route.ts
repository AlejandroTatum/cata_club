/**
 * POST /api/personas/[id]/representados — a representante adds a
 * second/third dependent (child) from the authenticated portal.
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/representados`.
 * REPRESENTANTE-only in the backend, additionally gated by an ownership
 * check (path `persona_id` must match the token's own `persona_id`) — we
 * just propagate whatever 401/403/400/422 the backend returns, same as
 * `[id]/roles/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PersonaResponse } from "@/types/domain";
import type { RepresentadoCreatePayload } from "@/services/api";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let body: RepresentadoCreatePayload;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as RepresentadoCreatePayload;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const backendBody: Record<string, unknown> = {
    nombres: body.nombres,
    apellidos: body.apellidos,
    cedula: body.cedula,
    fecha_nacimiento: body.fechaNacimiento,
    telefono: body.telefono,
  };
  if (body.fichaMedica) {
    backendBody.ficha_medica = {
      tipo_sangre: body.fichaMedica.tipoSangre,
      enfermedades: body.fichaMedica.enfermedades ?? [],
      alergias: body.fichaMedica.alergias,
      contacto_emergencia: body.fichaMedica.contactoEmergencia,
      telefono_emergencia: body.fichaMedica.telefonoEmergencia,
    };
  }
  // FIC-2: these three used to be dropped here. The wizard's credentials
  // step builds them into the payload and the backend's RepresentadoCreateDTO
  // accepts them (correo/contrasenia create the minor's own Usuario — Option
  // B, optional account), but this route silently discarded them before
  // forwarding: the API still answered 201 and the toast still said
  // "agregado correctamente", so the account never existed and nobody found
  // out until the child tried to log in.
  if (body.correo !== undefined) backendBody.correo = body.correo;
  if (body.contrasenia !== undefined) backendBody.contrasenia = body.contrasenia;
  if (body.institucionId !== undefined) backendBody.institucion_id = body.institucionId;

  const result = await backendFetchAuthed(request, `/personas/${personaId}/representados`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo agregar el dependiente." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo agregar el dependiente.");
  }

  const data = (await result.response.json()) as PersonaResponse;
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
