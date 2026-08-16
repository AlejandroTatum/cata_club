/**
 * POST /api/personas/[personaId]/foto — upload/replace a persona's photo
 * (carnet de socio, issue #286 slice 1).
 *
 * BFF proxy for FastAPI's `POST /personas/{persona_id}/foto`. Reads the
 * incoming `multipart/form-data` request, rebuilds the file into a fresh
 * `FormData` (field name `archivo`, matching the backend's `UploadFile =
 * File(...)` param), and forwards it via `backendFetchAuthed` — same
 * auth-cookie-resolution/refresh-and-retry helper as `me/foto/route.ts`. The
 * backend authorizes the owner, their representative, or an ADMINISTRADOR; we
 * just propagate whatever 401/403/400/422 it returns.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PersonaResponse } from "@/types/domain";

interface RouteContext {
  params: { personaId: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.personaId);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const archivo = incoming.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ message: "Debe adjuntar un archivo." }, { status: 400 });
  }

  const backendFormData = new FormData();
  backendFormData.append("archivo", archivo, archivo.name);

  const result = await backendFetchAuthed(request, `/personas/${personaId}/foto`, {
    method: "POST",
    body: backendFormData,
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo actualizar la foto." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar la foto.");
  }

  const data = (await result.response.json()) as PersonaResponse;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
