/**
 * POST /api/co-representantes/invitaciones — the primary guardian (or an
 * admin) invites a second guardian for one or more minors. Issue #1666.
 *
 * BFF proxy to FastAPI's `POST /co-representantes/invitaciones`. The backend
 * answers 201 (`INVITADO` / `VINCULADO`) or 200 (`REQUIERE_DATOS`: the e-mail
 * has no account and `datos` is needed to create it); both bodies and status
 * codes pass through. The backend body is snake_case, so the camelCase
 * browser payload is translated here and nothing else is added.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { InvitarCoRepresentantePayload } from "@/services/api";

const MENSAJE_ERROR = "No se pudo enviar la invitación.";

function toBackendBody(payload: InvitarCoRepresentantePayload): Record<string, unknown> {
  const { datos } = payload;
  return {
    persona_ids: payload.personaIds,
    correo: payload.correo,
    ...(datos
      ? {
          datos: {
            nombres: datos.nombres,
            apellidos: datos.apellidos,
            cedula: datos.cedula,
            fecha_nacimiento: datos.fechaNacimiento,
            telefono: datos.telefono,
          },
        }
      : {}),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: InvitarCoRepresentantePayload;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as InvitarCoRepresentantePayload;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, "/co-representantes/invitaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBackendBody(body)),
  });

  if (!result.ok) {
    return NextResponse.json({ message: MENSAJE_ERROR }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, MENSAJE_ERROR);
  }

  const response = NextResponse.json(await result.response.json(), { status: result.response.status });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
