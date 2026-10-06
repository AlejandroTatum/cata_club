/**
 * BFF proxy — POST /api/dias-sin-clase/[id]/avisar (issue #1665)
 *
 * Admin-only resend of a no-class day's notice. The backend dedups per
 * account, so only members who never got it are reached; it answers 409 for a
 * day that already ended. Its status and message pass through.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

type Props = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, props: Props): Promise<NextResponse> {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ message: "Identificador de día sin clase inválido." }, { status: 400 });
  }
  const result = await backendFetchAuthed(request, `/dias-sin-clase/${id}/avisar`, { method: "POST" });
  if (!result.ok) return NextResponse.json({ message: "No se pudo reenviar el aviso." }, { status: result.status });
  if (!result.response.ok) return passthroughBackendError(result.response, "No se pudo reenviar el aviso.");
  const response = NextResponse.json(await result.response.json(), { status: 202 });
  if (result.refreshedAccessToken) setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  return response;
}
