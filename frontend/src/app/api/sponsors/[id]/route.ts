import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json({ message: "Identificador de patrocinador inválido." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, `/sponsors/${params.id}`, { method: "DELETE" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo eliminar el patrocinador." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo eliminar el patrocinador.");
  return new NextResponse(null, { status: 204 });
}
