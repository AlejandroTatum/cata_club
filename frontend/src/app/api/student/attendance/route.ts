/**
 * GET /api/student/attendance?personaId=<id>&skip=<n>&limit=<n> — one page of
 * a persona's attendance history, newest first.
 *
 * `GET /api/student` only carries the most recent window of sessions per
 * profile; this is how the attendance screen reaches the older ones. It wraps
 * the paginated `GET /asistencias/persona/{id}` (owner, representative or
 * staff — the backend decides, this handler only relays its refusal) and
 * labels each session with its horario, like the portal aggregate does.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { BackendAsistencia, BackendHorario } from "@/lib/server/attendance-adapter";
import { buildSessionViews } from "@/lib/server/student-adapter";

/** The backend's per-request ceiling on `GET /asistencias/persona/{id}`. */
const MAX_LIMIT = 200;

interface BackendHistorialPage {
  items: BackendAsistencia[];
  total: number;
  skip: number;
  limit: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const personaId = Number(params.get("personaId"));
  const skip = Number(params.get("skip") ?? "0");
  const limit = Number(params.get("limit") ?? "30");
  if (
    !Number.isInteger(personaId) || personaId <= 0 ||
    !Number.isInteger(skip) || skip < 0 ||
    !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT
  ) {
    return NextResponse.json({ message: "Los parámetros de la consulta no son válidos." }, { status: 400 });
  }

  const [historial, horarios] = await Promise.all([
    backendFetchAuthed(request, `/asistencias/persona/${personaId}?skip=${skip}&limit=${limit}`),
    backendFetchAuthed(request, "/asistencias/horarios"),
  ]);
  if (!historial.ok) {
    return NextResponse.json({ message: "No autorizado" }, { status: historial.status });
  }
  if (!historial.response.ok) {
    return passthroughBackendError(historial.response, "No se pudo cargar el historial de asistencia.");
  }
  if (!horarios.ok || !horarios.response.ok) {
    return NextResponse.json({ message: "No se pudo cargar el historial de asistencia." }, { status: 502 });
  }

  const page = (await historial.response.json()) as BackendHistorialPage;
  const horariosById = new Map(((await horarios.response.json()) as BackendHorario[]).map((h) => [h.id, h]));

  const response = NextResponse.json(
    { items: buildSessionViews(page.items, horariosById), total: page.total, skip: page.skip, limit: page.limit },
    { headers: { "Cache-Control": "no-store" } },
  );
  const refreshed = historial.refreshedAccessToken ?? horarios.refreshedAccessToken;
  if (refreshed) setAuthCookies(response, { accessToken: refreshed });
  return response;
}
