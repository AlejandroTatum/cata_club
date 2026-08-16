/**
 * GET /api/auth/me/sesiones — historial de sesiones propio.
 *
 * No lleva parámetros y no puede llevarlos: el backend resuelve la identidad
 * por el `sub` del JWT, así que no hay forma de pedir el historial de otra
 * cuenta ni siquiera intentándolo desde acá.
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBackendGet(
    request,
    "/auth/me/sesiones",
    "No se pudo cargar el historial de sesiones.",
  );
}
