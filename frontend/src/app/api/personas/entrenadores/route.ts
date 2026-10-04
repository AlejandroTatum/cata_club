/**
 * POST /api/personas/entrenadores — an ADMINISTRADOR creates a trainer
 * directly (issue #1575): minimal data, a trainer-only account, and an invite
 * email with a link to set the password.
 *
 * BFF proxy to FastAPI's `POST /personas/entrenadores`. No role check here
 * (BFF routes in this repo never do): the backend answers 401/403 and the
 * duplicate-identity 400 and this route relays them.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

const FIELDS = ["nombres", "apellidos", "cedula", "fechaNacimiento", "correo", "telefono"] as const;
const REQUIRED_FIELDS_MESSAGE =
  "Nombres, apellidos, cédula, fecha de nacimiento, correo y celular son obligatorios.";
const FALLBACK = "No se pudo crear al entrenador.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Partial<Record<(typeof FIELDS)[number], unknown>>;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as typeof body;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (FIELDS.some((field) => typeof body[field] !== "string" || !body[field])) {
    return NextResponse.json({ message: REQUIRED_FIELDS_MESSAGE }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, "/personas/entrenadores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombres: body.nombres,
      apellidos: body.apellidos,
      cedula: body.cedula,
      fecha_nacimiento: body.fechaNacimiento,
      correo: body.correo,
      telefono: body.telefono,
    }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: FALLBACK }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, FALLBACK);
  }

  const created = (await result.response.json()) as { id: number };
  const response = NextResponse.json({ personaId: created.id }, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
