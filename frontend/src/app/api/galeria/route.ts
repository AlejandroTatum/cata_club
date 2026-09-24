import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await backendFetch("/galeria/", { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo cargar la galería." }, { status: 503 });
  if (!result.data.ok) return passthroughBackendError(result.data, "No se pudo cargar la galería.");
  return NextResponse.json(await result.data.json());
}

/** POST /galeria — proxies the admin upload. When the backend itself is
 * unreachable (network, timeout, misconfiguration), the message must be an
 * honest service error: never a size/format claim, which only the backend's
 * own validated 4xx responses (passed through verbatim below) may make. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const titulo = formData.get("titulo");
  const descripcion = formData.get("descripcion");
  const archivo = formData.get("archivo");
  if (typeof titulo !== "string" || !titulo.trim() || typeof descripcion !== "string" || !descripcion.trim() || !(archivo instanceof File)) {
    return NextResponse.json({ message: "El título, la descripción y la imagen son obligatorios." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, "/galeria/", { method: "POST", body: formData });
  if (!result.ok) return NextResponse.json({ message: "El servicio de publicación no está disponible en este momento." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo publicar la foto.");
  return NextResponse.json(await result.response.json(), { status: 201 });
}
