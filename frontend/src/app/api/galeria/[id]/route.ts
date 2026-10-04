import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

type Props = { params: Promise<{ id: string }> };

const ID_INVALIDO = (): NextResponse =>
  NextResponse.json({ message: "Identificador de foto inválido." }, { status: 400 });

/** DELETE /galeria/{id} — the admin screen calls `/api/galeria/{id}`; without this route the delete 404'd. */
export async function DELETE(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) return ID_INVALIDO();
  const result = await backendFetchAuthed(request, `/galeria/${id}`, { method: "DELETE" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo eliminar la foto." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo eliminar la foto.");
  return new NextResponse(null, { status: 204 });
}
