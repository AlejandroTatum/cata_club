import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const description = form.get("descripcion");
  if (typeof description !== "string" || !description.trim() || description.length > 2000) {
    return NextResponse.json({ message: "Escribe una descripción del problema." }, { status: 400 });
  }
  const screenshot = form.get("captura");
  if (screenshot !== null && (!(screenshot instanceof File) || screenshot.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(screenshot.type))) {
    return NextResponse.json({ message: "Adjunta una imagen PNG, JPEG o WebP de hasta 2 MB." }, { status: 400 });
  }
  const requestId = request.headers.get("X-Request-ID");
  const result = await backendFetchAuthed(request, "/reportes-error/", {
    method: "POST", body: form,
    ...(requestId ? { headers: { "X-Request-ID": requestId } } : {}),
  });
  if (!result.ok) return NextResponse.json({ message: "No se pudo contactar al servicio de reportes." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo enviar el reporte.");
  return NextResponse.json(await result.response.json(), { status: 201 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const search = request.nextUrl.search;
  const result = await backendFetchAuthed(request, `/reportes-error/${search}`, { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo cargar la bandeja." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo cargar la bandeja.");
  return NextResponse.json(await result.response.json());
}
