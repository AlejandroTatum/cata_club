/**
 * POST /api/personas/admin/cuentas — admin creates a full account
 * (Persona + Usuario + Rol) in one request.
 *
 * BFF proxy to FastAPI's `POST /personas/admin/cuentas`.
 * ADMINISTRADOR-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface AdminCuentaBody {
  tipo_cuenta: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  fecha_nacimiento: string;
  telefono: string;
  telefono_contacto?: string;
  correo: string;
  contrasenia: string;
  representante_id?: number;
  institucion_id?: number;
  ficha_medica?: {
    tipo_sangre?: string;
    enfermedades?: string[];
    alergias?: string;
    contacto_emergencia?: string;
    telefono_emergencia?: string;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: AdminCuentaBody;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    body = raw as AdminCuentaBody;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (!body.tipo_cuenta || !["JUGADOR", "REPRESENTANTE", "MENOR"].includes(body.tipo_cuenta)) {
    return NextResponse.json({ message: "El tipo de cuenta no es válido." }, { status: 400 });
  }

  if (!body.nombres?.trim() || !body.apellidos?.trim() || !body.cedula?.trim() || !body.telefono?.trim()) {
    return NextResponse.json({ message: "Faltan campos obligatorios." }, { status: 400 });
  }

  if (!body.correo || !body.contrasenia) {
    return NextResponse.json({ message: "Las credenciales son obligatorias." }, { status: 400 });
  }

  if (body.tipo_cuenta === "MENOR" && !body.representante_id) {
    return NextResponse.json({ message: "El menor requiere un representante legal." }, { status: 400 });
  }

  const backendBody: Record<string, unknown> = {
    tipo_cuenta: body.tipo_cuenta,
    nombres: body.nombres.trim(),
    apellidos: body.apellidos.trim(),
    cedula: body.cedula.trim(),
    fecha_nacimiento: body.fecha_nacimiento,
    telefono: body.telefono.trim(),
    correo: body.correo.trim(),
    contrasenia: body.contrasenia,
  };

  if (body.telefono_contacto) backendBody.telefono_contacto = body.telefono_contacto.trim();
  if (body.representante_id) backendBody.representante_id = body.representante_id;
  if (body.institucion_id) backendBody.institucion_id = body.institucion_id;
  if (body.ficha_medica) backendBody.ficha_medica = body.ficha_medica;

  const result = await backendFetchAuthed(request, "/personas/admin/cuentas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backendBody),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo crear la cuenta. Inicie sesión nuevamente." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo crear la cuenta.");
  }

  let data: Record<string, unknown>;
  try {
    data = (await result.response.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Respuesta inesperada del servidor." }, { status: 502 });
  }
  const response = NextResponse.json(data, { status: 201 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
