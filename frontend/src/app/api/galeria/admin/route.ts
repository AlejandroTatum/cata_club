import { NextRequest, NextResponse } from "next/server";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

/** GET /galeria/admin — every entry, hidden ones included (ADMB-34). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/galeria/admin", { method: "GET" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo cargar la galería." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo cargar la galería.");
  return NextResponse.json(await result.response.json());
}
