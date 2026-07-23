/**
 * GET /api/personas/[id]/roles — read current roles + activo (no mutation).
 * POST /api/personas/[id]/roles — assign a role.
 * DELETE /api/personas/[id]/roles?tipoRol=... — remove a role.
 *
 * BFF proxies to FastAPI's:
 *   GET /personas/{persona_id}/roles
 *   POST /personas/{persona_id}/roles
 *   DELETE /personas/{persona_id}/roles/{tipo_rol}
 * All three are ADMINISTRADOR-only in the backend; we propagate its 401/403.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { BackendTipoRol, RolesResponse } from "@/types/domain";

interface RouteContext {
  params: { id: string };
}

interface AssignBody {
  tipoRol: BackendTipoRol;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/roles`, {
    method: "GET",
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron obtener los roles." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron obtener los roles.");
  }

  const data = (await result.response.json()) as RolesResponse;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let body: AssignBody;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as AssignBody;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo_rol: body.tipoRol }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo asignar el rol." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo asignar el rol.");
  }

  const data = (await result.response.json()) as RolesResponse;
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const tipoRol = searchParams.get("tipoRol");
  if (!tipoRol) {
    return NextResponse.json({ message: "El parámetro tipoRol es requerido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/roles/${tipoRol}`, {
    method: "DELETE",
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo quitar el rol." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo quitar el rol.");
  }

  const data = (await result.response.json()) as RolesResponse;
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
