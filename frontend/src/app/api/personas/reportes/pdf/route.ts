/**
 * GET /api/personas/reportes/pdf — admin-only BFF binary proxy.
 *
 * Proxies FastAPI's `/personas/reportes/pdf` with optional query filters
 * (prioridad_municipal, becado) and relays the `application/pdf` body plus
 * `Content-Disposition` verbatim. Mirrors `/api/personas/reportes/route.ts`
 * but reads the backend response as `arrayBuffer()` instead of `json()` —
 * `backendFetchAuthed` already returns the raw `Response`, so no new
 * proxy helper is needed for binary payloads.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const prioridad = searchParams.get("prioridad_municipal");
  const becado = searchParams.get("becado");
  if (prioridad !== null) qs.set("prioridad_municipal", prioridad);
  if (becado !== null) qs.set("becado", becado);
  const query = qs.toString();

  const result = await backendFetchAuthed(request, `/personas/reportes/pdf${query ? `?${query}` : ""}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo generar el PDF del reporte." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo generar el PDF del reporte.");
  }

  const body = await result.response.arrayBuffer();
  const contentDisposition =
    result.response.headers.get("content-disposition") ??
    `attachment; filename="reporte-etiquetas.pdf"`;

  const response = new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition,
    },
  });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
