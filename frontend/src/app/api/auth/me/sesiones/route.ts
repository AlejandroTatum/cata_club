/**
 * GET /api/auth/me/sesiones — historial de sesiones propio.
 *
 * Solo reenvía `limite` y `desplazamiento` (paginación), y solo si son enteros
 * no negativos; cualquier otro parámetro se descarta. El backend resuelve la
 * identidad por el `sub` del JWT, así que no hay forma de pedir el historial
 * de otra cuenta ni siquiera intentándolo desde acá. El rango válido lo decide
 * el backend (422 si se pasa).
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";

const PAGINATION_PARAMS = ["limite", "desplazamiento"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = new URLSearchParams();
  for (const name of PAGINATION_PARAMS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null && /^\d+$/.test(value)) query.set(name, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return proxyBackendGet(
    request,
    `/auth/me/sesiones${suffix}`,
    "No se pudo cargar el historial de sesiones.",
  );
}
