import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { setAuthCookies } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ message: "ID inválido" }, { status: 400 });
  const result = await backendFetchAuthed(request, `/reportes-error/${id}`, { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "Servicio no disponible" }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo cargar el reporte.");
  const response = NextResponse.json(await result.response.json(), { headers: { "Cache-Control": "no-store" } });
  if (result.refreshedAccessToken) setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  return response;
}
