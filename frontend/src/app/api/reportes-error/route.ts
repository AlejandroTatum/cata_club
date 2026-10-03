import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { setAuthCookies, userAgentFrom } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const description = form.get("descripcion");
  if (typeof description !== "string" || !description.trim() || description.length > 2000) {
    return NextResponse.json({ message: "Escriba una descripción del problema." }, { status: 400 });
  }
  const screenshot = form.get("captura");
  if (screenshot !== null && (!(screenshot instanceof File) || screenshot.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(screenshot.type))) {
    return NextResponse.json({ message: "Adjunte una imagen PNG, JPEG o WebP de hasta 2 MB." }, { status: 400 });
  }
  if (screenshot !== null && form.get("consentimiento_captura") !== "true") {
    return NextResponse.json({ message: "Debe aceptar el envío de la captura." }, { status: 400 });
  }
  const requestId = request.headers.get("X-Request-ID");
  // The backend stores the User-Agent it receives; without this it records the BFF's own ("node").
  const userAgent = userAgentFrom(request);
  const forwarded: Record<string, string> = {
    ...(requestId ? { "X-Request-ID": requestId } : {}),
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  };
  const result = await backendFetchAuthed(request, "/reportes-error/", {
    method: "POST", body: form,
    ...(Object.keys(forwarded).length ? { headers: forwarded } : {}),
  });
  if (!result.ok) return NextResponse.json({ message: "No se pudo contactar al servicio de reportes." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo enviar el reporte.");
  const response = NextResponse.json(await result.response.json(), { status: 201, headers: { "Cache-Control": "no-store" } });
  if (result.refreshedAccessToken) setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const search = request.nextUrl.search;
  const result = await backendFetchAuthed(request, `/reportes-error/${search}`, { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo cargar la bandeja." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo cargar la bandeja.");
  const response = NextResponse.json(await result.response.json(), { headers: { "Cache-Control": "no-store" } });
  if (result.refreshedAccessToken) setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  return response;
}
