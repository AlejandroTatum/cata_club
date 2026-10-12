/**
 * POST /api/auth/me/foto — upload/replace the logged-in user's own profile
 * photo (self-service, any authenticated role).
 *
 * BFF proxy for FastAPI's `POST /auth/me/foto`. Reads the incoming
 * `multipart/form-data` request, rebuilds the file into a fresh `FormData`
 * (field name `archivo`, matching the backend's `UploadFile = File(...)`
 * param), and forwards it via `backendFetchAuthed` — same
 * auth-cookie-resolution/refresh-and-retry helper `GET`/`PATCH /api/auth/me`
 * use (see `../route.ts`). Unlike `PATCH /api/auth/me`, this endpoint never
 * changes `correo`, so the backend never reissues tokens — only a proactive
 * `refreshedAccessToken` rotation (from `backendFetchAuthed` itself) needs a
 * cookie update here.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PerfilPropio } from "@/types/domain";

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const result = await backendFetchAuthed(request, "/auth/me/foto", {
    method: "POST",
    body: backendFormData,
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo actualizar la foto de perfil." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo actualizar la foto de perfil.");
  }

  const data = (await result.response.json()) as PerfilPropio;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}
