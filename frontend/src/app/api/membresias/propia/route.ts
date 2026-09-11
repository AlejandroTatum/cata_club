/**
 * POST /api/membresias/propia — issue #1132: a representative enrolls
 * themselves as a player.
 *
 * Proxies FastAPI's `POST /membresias/propia` (membresias_pagos_router.py).
 * Autoservicio, NOT admin-only, same shape as
 * `POST /api/membresias/[id]/aplicar-beneficio`: the backend derives
 * `persona_id` from the caller's own token, never from this body — there is
 * no field here to point at another Persona. This handler stays open to any
 * authenticated caller and relays the backend's 401/400/422.
 *
 * Body carries only `tipoMembresiaId` (the plan the caller chose) — the
 * membership is born INACTIVA; the existing `POST /api/membresias/pagos`
 * registers the first payment against it.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  if (
    typeof body !== "object"
    || body === null
    || typeof (body as Record<string, unknown>).tipoMembresiaId !== "number"
  ) {
    return NextResponse.json(
      { message: "El campo tipoMembresiaId es obligatorio y debe ser numérico." },
      { status: 400 },
    );
  }

  const tipoMembresiaId = (body as { tipoMembresiaId: number }).tipoMembresiaId;

  const result = await backendFetchAuthed(request, "/membresias/propia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo_membresia_id: tipoMembresiaId }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo crear la membresía." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo crear la membresía.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
