import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await backendFetch("/sponsors/", { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo cargar los patrocinadores." }, { status: 503 });
  if (!result.data.ok) return passthroughBackendError(result.data, "No se pudo cargar los patrocinadores.");
  return NextResponse.json(await result.data.json());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const nombre = formData.get("nombre");
  const archivo = formData.get("archivo");
  if (typeof nombre !== "string" || !nombre.trim() || !(archivo instanceof File)) {
    return NextResponse.json({ message: "El nombre y el logo son obligatorios." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, "/sponsors/", { method: "POST", body: formData });
  if (!result.ok) return NextResponse.json({ message: "No se pudo crear el patrocinador." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo crear el patrocinador.");
  return NextResponse.json(await result.response.json(), { status: 201 });
}
