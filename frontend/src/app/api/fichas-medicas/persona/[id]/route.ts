/**
 * GET /api/fichas-medicas/persona/[id] — fetch a person's medical record.
 * PATCH /api/fichas-medicas/persona/[id] — update a person's medical record.
 *
 * BFF proxies to FastAPI's:
 *   GET /fichas-medicas/persona/{persona_id}
 *   PATCH /fichas-medicas/persona/{persona_id}
 * Both are ADMINISTRADOR-only in the backend; we propagate its 401/403.
 * IMPORTANT: when PATCH sends `enfermedades`, the backend replaces the whole list.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { FichaMedicaEditable, FichaMedicaUpdatePayload, TipoSangre } from "@/types/domain";

interface RouteContext {
  params: { id: string };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/fichas-medicas/persona/${personaId}`);

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar la ficha médica." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar la ficha médica.");
  }

  const data = (await result.response.json()) as FichaMedicaEditable;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}

interface PatchBody {
  tipoSangre?: TipoSangre;
  enfermedades?: string[];
  alergias?: string | null;
  contactoEmergencia?: string | null;
  telefonoEmergencia?: string | null;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as PatchBody;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const payload: FichaMedicaUpdatePayload = {
    ...(body.tipoSangre !== undefined ? { tipoSangre: body.tipoSangre } : {}),
    ...(body.enfermedades !== undefined ? { enfermedades: body.enfermedades } : {}),
    ...(body.alergias !== undefined ? { alergias: body.alergias } : {}),
    ...(body.contactoEmergencia !== undefined ? { contactoEmergencia: body.contactoEmergencia } : {}),
    ...(body.telefonoEmergencia !== undefined ? { telefonoEmergencia: body.telefonoEmergencia } : {}),
  };

  const backendBody: Record<string, unknown> = {};
  if (payload.tipoSangre !== undefined) backendBody.tipo_sangre = payload.tipoSangre;
  if (payload.enfermedades !== undefined) backendBody.enfermedades = payload.enfermedades;
  if (payload.alergias !== undefined) backendBody.alergias = payload.alergias;
  if (payload.contactoEmergencia !== undefined) backendBody.contacto_emergencia = payload.contactoEmergencia;
  if (payload.telefonoEmergencia !== undefined) backendBody.telefono_emergencia = payload.telefonoEmergencia;

  const result = await backendFetchAuthed(request, `/fichas-medicas/persona/${personaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo actualizar la ficha médica." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar la ficha médica.");
  }

  const data = (await result.response.json()) as FichaMedicaEditable;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
