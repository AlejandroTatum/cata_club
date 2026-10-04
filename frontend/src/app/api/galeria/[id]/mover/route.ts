import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

/** POST /galeria/{id}/mover — one step up or down in the gallery order (ADMB-34). */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ message: "Identificador de foto inválido." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  const direccion = (body as { direccion?: unknown } | null)?.direccion;
  if (direccion !== "subir" && direccion !== "bajar") {
    return NextResponse.json({ message: "Dirección inválida." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, `/galeria/${id}/mover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direccion }),
  });
  if (!result.ok) return NextResponse.json({ message: "No se pudo mover la foto." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo mover la foto.");
  return NextResponse.json(await result.response.json());
}
