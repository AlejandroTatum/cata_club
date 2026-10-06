/**
 * BFF proxy — PUT/DELETE /api/dias-sin-clase/[id] (issue #1665)
 *
 * Admin-only edit and delete of a no-class day; the backend enforces the role.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { deleteCatalogResource } from "@/lib/server/bff-helpers";

type Props = { params: Promise<{ id: string }> };

const ID_INVALIDO = "Identificador de día sin clase inválido.";

export async function PUT(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ message: ID_INVALIDO }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }
  const parsed = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!parsed.fecha_inicio || !parsed.motivo) {
    return NextResponse.json({ message: "La fecha y el motivo son obligatorios." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, `/dias-sin-clase/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fecha_inicio: parsed.fecha_inicio,
      fecha_fin: parsed.fecha_fin ?? null,
      motivo: parsed.motivo,
    }),
  });
  if (!result.ok) return NextResponse.json({ message: "No se pudo guardar el día sin clase." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo guardar el día sin clase.");
  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  return response;
}

export async function DELETE(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  return deleteCatalogResource(request, {
    id,
    buildPath: (value) => `/dias-sin-clase/${value}`,
    invalidIdMessage: ID_INVALIDO,
    failureMessage: "No se pudo eliminar el día sin clase.",
  });
}
