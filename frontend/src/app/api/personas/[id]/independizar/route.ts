/**
 * POST /api/personas/[id]/independizar — a minor-turned-adult or admin
 * removes the representante link from a Persona.
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/independizar`.
 * Owner or ADMINISTRADOR only.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PersonaResponse } from "@/types/domain";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let body: { contrasenia?: string };
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as { contrasenia?: string };
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (!body.contrasenia || typeof body.contrasenia !== "string") {
    return NextResponse.json({ message: "La contraseña es obligatoria." }, { status: 400 });
  }

  const backendBody = { contrasenia: body.contrasenia };

  const result = await backendFetchAuthed(request, `/personas/${personaId}/independizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo procesar la solicitud. Inicie sesión nuevamente." },
      { status: 401 },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo independizar la cuenta.");
  }

  const data = (await result.response.json()) as PersonaResponse;
  const response = NextResponse.json(data, { status: 200 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
