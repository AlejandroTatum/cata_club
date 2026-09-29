import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

/** Enroll a dependent and register the first payment as a single backend operation. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "Faltan campos obligatorios." }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;
  if (!Number.isSafeInteger(fields.personaId) || Number(fields.personaId) < 1
    || !Number.isSafeInteger(fields.tipoMembresiaId) || Number(fields.tipoMembresiaId) < 1
    || !Number.isSafeInteger(fields.meses) || Number(fields.meses) < 1 || Number(fields.meses) > 12
    || (fields.tipoPago !== "EFECTIVO" && fields.tipoPago !== "TRANSFERENCIA")) {
    return NextResponse.json({ message: "Persona, plan, medio de pago y meses válidos son obligatorios." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, "/membresias/representado/pago", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      persona_id: fields.personaId,
      tipo_membresia_id: fields.tipoMembresiaId,
      tipo_pago: fields.tipoPago,
      meses: fields.meses,
    }),
  });
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo registrar el pago." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar el pago.");
  }
  const response = NextResponse.json(await result.response.json(), { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
