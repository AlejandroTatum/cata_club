import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

type Props = { params: Promise<{ id: string }> };

const ID_INVALIDO = (): NextResponse =>
  NextResponse.json({ message: "Identificador de foto inválido." }, { status: 400 });

export async function DELETE(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) return ID_INVALIDO();
  const result = await backendFetchAuthed(request, `/galeria/${id}`, { method: "DELETE" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo eliminar la foto." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo eliminar la foto.");
  return new NextResponse(null, { status: 204 });
}

/** PUT /galeria/{id} — admin edit (ADMB-34): text, visibility and, optionally, the cropped photo. */
export async function PUT(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) return ID_INVALIDO();
  const formData = await request.formData();
  const titulo = formData.get("titulo");
  const descripcion = formData.get("descripcion");
  if (typeof titulo !== "string" || !titulo.trim() || typeof descripcion !== "string" || !descripcion.trim()) {
    return NextResponse.json({ message: "El título y la descripción son obligatorios." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, `/galeria/${id}`, { method: "PUT", body: formData });
  if (!result.ok) return NextResponse.json({ message: "El servicio de publicación no está disponible en este momento." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo guardar la foto.");
  return NextResponse.json(await result.response.json());
}
