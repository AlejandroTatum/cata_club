/**
 * GET /api/carnets?ids=1,2,3 — the data behind the admin's carnet printing
 * (issue #1670), one entry per persona, in the order asked.
 *
 * Each entry is what the player's own card reads: the profile
 * `/api/student` builds from `GET /portal/alumno/{id}` (the persona itself —
 * `titular` — never someone they represent), the coverage date, and the
 * assignments from `GET /asistencias/alumnos/{id}/horarios`. Nothing the player
 * does not already see on their carnet; payment status stays off it.
 *
 * ADMIN ONLY, enforced here: both backend endpoints also answer to the person
 * themselves, so without `requireAdmin` any member could read their own data
 * through a route meant for the club. A persona whose portal OR schedule cannot be read lands in
 * `missing` rather than failing the whole sheet.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { requireAdmin } from "@/lib/server/require-admin";
import {
  buildPortalProfile,
  type BackendPortalPerfil,
  type BackendTipoMembresiaCatalogo,
  type CarnetView,
} from "@/lib/server/student-adapter";
import type { BackendHorario } from "@/lib/server/attendance-adapter";

/** More than this is more than the club prints at once (about seven A4 sheets). */
const CARNETS_MAX_IDS = 60;

/** Upstream reads in flight at once: two per persona, so this is eight. */
const CONCURRENCY = 4;

interface BackendPortalAlumno {
  titular: BackendPortalPerfil;
  horarios: BackendHorario[];
  tipos: BackendTipoMembresiaCatalogo[];
}

function parseIds(raw: string | null): number[] | null {
  if (!raw) return null;
  const ids = raw.split(",").map((part) => (/^\d+$/.test(part.trim()) ? Number(part.trim()) : NaN));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  return [...new Set(ids)];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const ids = parseIds(request.nextUrl.searchParams.get("ids"));
  if (!ids || ids.length > CARNETS_MAX_IDS) {
    return NextResponse.json(
      { message: `Indica entre 1 y ${CARNETS_MAX_IDS} jugadores.` },
      { status: 400 },
    );
  }

  let refreshedAccessToken = admin.refreshedAccessToken;

  async function load(personaId: number): Promise<CarnetView | null> {
    const [portal, horarios] = await Promise.all([
      backendFetchAuthed(request, `/portal/alumno/${personaId}?historial_limite=1`),
      backendFetchAuthed(request, `/asistencias/alumnos/${personaId}/horarios`),
    ]);
    for (const result of [portal, horarios]) {
      if (result.ok && result.refreshedAccessToken) refreshedAccessToken = result.refreshedAccessToken;
    }
    // A schedule that failed to load is not "no training days": printing it so
    // would put wrong data on a physical card, so the persona is reported as missing.
    if (!portal.ok || !portal.response.ok || !horarios.ok || !horarios.response.ok) return null;
    const aggregate = (await portal.response.json()) as BackendPortalAlumno;
    const profile = buildPortalProfile(
      aggregate.titular,
      new Map(aggregate.horarios.map((horario) => [horario.id, horario])),
      new Map(aggregate.tipos.map((tipo) => [tipo.id, tipo])),
    );
    const asignaciones = (await horarios.response.json()) as unknown[];
    return { profile, coverageEnd: profile.membership?.cubiertoHasta ?? null, asignaciones };
  }

  const loaded = new Map<number, CarnetView | null>();
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    const batch = ids.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => load(id).catch(() => null)));
    batch.forEach((id, position) => loaded.set(id, results[position]));
  }

  const response = NextResponse.json({
    carnets: ids.flatMap((id) => loaded.get(id) ?? []),
    missing: ids.filter((id) => !loaded.get(id)),
  });
  if (refreshedAccessToken) setAuthCookies(response, { accessToken: refreshedAccessToken });
  return response;
}
