/**
 * GET /api/attendance/records — proxies FastAPI's `/asistencias/reportes`,
 *   looping backend pages internally (`fetchAllReportes`, TRA-6) since that
 *   endpoint is now paginated but this route's own contract — one full array
 *   for the filtered range — is not (see `fetchAllReportes`'s doc comment).
 * POST /api/attendance/records — registers real attendance (CU / E02),
 *   proxying `POST /asistencias/` once per student in the roster.
 *
 * BFF Route Handlers: role enforcement (ADMINISTRADOR/ENTRENADOR for both
 * read and write) is the backend's job via `GestorPermisos` — these handlers
 * just proxy whatever status FastAPI returns. GET enriches each Asistencia
 * with a "Día HH:mm — HH:mm" schedule label (resolved via
 * `/asistencias/horarios`, see src/lib/server/attendance-adapter.ts); the
 * student's name travels straight in `AsistenciaResponseDTO` (issue #358,
 * `personaNombreCompleto`), so there is no per-id `/personas/{id}` lookup
 * here anymore. Consumed by the admin `/attendance` overview, `/reports`,
 * `/dashboard`, the trainer dashboard/history pages, and the trainer
 * panel's "última lista".
 *
 * POST replaces the old frontend-only prototype in `/trainer/attendance`
 * (previously "no data is persisted") — it issues one real
 * `POST /asistencias/` per student, tolerating partial failure (e.g. a
 * stale roster entry for a persona removed mid-session) instead of failing
 * the whole batch.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import {
  buildAttendanceRecord,
  ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND,
  type BackendAsistencia,
  type BackendHorario,
} from "@/lib/server/attendance-adapter";
import type { EstadoAsistencia } from "@/types/domain";
import { clubIsoDate } from "@/lib/club-date";

const VALID_ESTADOS = new Set<string>(Object.keys(ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND));

/**
 * `GET /asistencias/reportes` is now paginated server-side (TRA-6, capped at
 * `REPORTES_PAGE_LIMIT`) so a single request can never force one unbounded
 * query — but every consumer of THIS route (`/reports`'s CSV/PDF-count
 * parity, `/attendance`, `/dashboard`, `/trainer*`) is written against "one
 * full array for the filtered range" (see reports-utils.ts's doc comment on
 * why that parity matters). `fetchAllReportes` loops backend pages so that
 * contract holds unchanged: the backend query is bounded, this route's own
 * response is not.
 */
const REPORTES_PAGE_LIMIT = 200;

interface PaginatedAsistencias {
  items: BackendAsistencia[];
  total: number;
}

type ReportesResult =
  | { ok: true; items: BackendAsistencia[]; refreshedAccessToken?: string }
  | { ok: false; status: number; response?: Response };

async function fetchAllReportes(request: NextRequest, baseQuery: URLSearchParams): Promise<ReportesResult> {
  const items: BackendAsistencia[] = [];
  let refreshedAccessToken: string | undefined;
  let skip = 0;
  while (true) {
    const pageQs = new URLSearchParams(baseQuery);
    pageQs.set("skip", String(skip));
    pageQs.set("limit", String(REPORTES_PAGE_LIMIT));
    const result = await backendFetchAuthed(request, `/asistencias/reportes?${pageQs.toString()}`);
    if (!result.ok) return { ok: false, status: result.status };
    if (!result.response.ok) return { ok: false, status: result.response.status, response: result.response };
    refreshedAccessToken = result.refreshedAccessToken ?? refreshedAccessToken;

    const page = (await result.response.json()) as PaginatedAsistencias;
    items.push(...page.items);
    if (page.items.length < REPORTES_PAGE_LIMIT || items.length >= page.total) break;
    skip += REPORTES_PAGE_LIMIT;
  }
  return { ok: true, items, refreshedAccessToken };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const fechaInicio = searchParams.get("fechaInicio");
  const fechaFin = searchParams.get("fechaFin");
  const horarioId = searchParams.get("horarioId");
  const personaId = searchParams.get("personaId");
  if (fechaInicio) qs.set("fecha_inicio", fechaInicio);
  if (fechaFin) qs.set("fecha_fin", fechaFin);
  if (horarioId) qs.set("horario_id", horarioId);
  if (personaId) qs.set("persona_id", personaId);

  const reportesResult = await fetchAllReportes(request, qs);
  if (!reportesResult.ok) {
    if (reportesResult.response) {
      return passthroughBackendError(reportesResult.response, "No se pudieron cargar los registros de asistencia.");
    }
    return NextResponse.json({ message: "No se pudieron cargar los registros de asistencia." }, { status: reportesResult.status });
  }

  const asistencias = reportesResult.items;

  const horariosResult = await backendFetchAuthed(request, "/asistencias/horarios");
  const horarios: BackendHorario[] =
    horariosResult.ok && horariosResult.response.ok ? await horariosResult.response.json() : [];
  const horariosById = new Map(horarios.map((h) => [h.id, h]));

  const records = asistencias.map((asistencia) =>
    buildAttendanceRecord(asistencia, horariosById.get(asistencia.horarioId)),
  );

  const response = NextResponse.json(records);
  if (reportesResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: reportesResult.refreshedAccessToken });
  }
  return response;
}

interface RegisterAttendanceStudent {
  personaId: number;
  estado: EstadoAsistencia;
}

interface RegisterAttendanceBody {
  horarioId: number;
  fechaEntrenamiento?: string;
  students: RegisterAttendanceStudent[];
}

/**
 * The default `fecha_entrenamiento` when the client omits it.
 *
 * MUST be the club's date, not the server's: this route runs on a host that
 * is almost certainly UTC, where 19:00 in Ecuador is already tomorrow. Every
 * evening session filed without an explicit date was landing on the wrong
 * day.
 */
function todayIsoDate(): string {
  return clubIsoDate();
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseRegisterBody(value: unknown): RegisterAttendanceBody | { error: string } {
  if (typeof value !== "object" || value === null) {
    return { error: "Cuerpo de la solicitud inválido." };
  }
  const body = value as Record<string, unknown>;

  if (!isPositiveInteger(body.horarioId)) return { error: "horarioId es obligatorio y debe ser un entero positivo." };
  if (body.fechaEntrenamiento !== undefined && typeof body.fechaEntrenamiento !== "string") {
    return { error: "fechaEntrenamiento debe ser una fecha en formato YYYY-MM-DD." };
  }
  if (!Array.isArray(body.students) || body.students.length === 0) {
    return { error: "students es obligatorio y debe tener al menos un estudiante." };
  }

  const students: RegisterAttendanceStudent[] = [];
  for (const raw of body.students) {
    if (typeof raw !== "object" || raw === null) return { error: "Cada estudiante debe ser un objeto." };
    const s = raw as Record<string, unknown>;
    if (!isPositiveInteger(s.personaId)) return { error: "Cada estudiante requiere un personaId entero positivo." };
    if (typeof s.estado !== "string" || !VALID_ESTADOS.has(s.estado)) {
      return { error: `Estado de asistencia inválido: ${String(s.estado)}` };
    }
    students.push({ personaId: s.personaId, estado: s.estado as EstadoAsistencia });
  }

  return {
    horarioId: body.horarioId,
    fechaEntrenamiento: typeof body.fechaEntrenamiento === "string" ? body.fechaEntrenamiento : undefined,
    students,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud" }, { status: 400 });
  }

  const parsed = parseRegisterBody(rawBody);
  if ("error" in parsed) {
    return NextResponse.json({ message: parsed.error }, { status: 400 });
  }

  const fecha = parsed.fechaEntrenamiento ?? todayIsoDate();

  const outcomes = await Promise.all(
    parsed.students.map(async (student) => {
      const result = await backendFetchAuthed(request, "/asistencias/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha_entrenamiento: fecha,
          estado: ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND[student.estado],
          persona_id: student.personaId,
          horario_id: parsed.horarioId,
        }),
      });

      if (!result.ok) {
        return {
          student,
          ok: false as const,
          status: result.status,
          message: "No se pudo contactar al servidor.",
          registradoPorNombre: null,
          refreshedAccessToken: undefined,
        };
      }
      if (!result.response.ok) {
        let message = "No se pudo registrar la asistencia.";
        try {
          const errorBody: unknown = await result.response.json();
          if (typeof errorBody === "object" && errorBody !== null) {
            const b = errorBody as Record<string, unknown>;
            message = (typeof b.message === "string" && b.message) || (typeof b.detail === "string" && b.detail) || message;
          }
        } catch {
          // ignore parse errors — use fallback
        }
        return {
          student,
          ok: false as const,
          status: result.response.status,
          message,
          registradoPorNombre: null,
          refreshedAccessToken: result.refreshedAccessToken,
        };
      }
      // The backend `POST /asistencias/` returns the created Asistencia, now
      // including `registradoPorNombre` (issue #263). Capturing it here lets the
      // receipt show the PERSISTED taker instead of a browser-side name (the
      // fake traceability the issue reports). Best-effort: if the body can't be
      // parsed, the receipt falls back to "No registrado".
      let registradoPorNombre: string | null = null;
      try {
        const created = (await result.response.json()) as { registradoPorNombre?: string | null };
        registradoPorNombre = created.registradoPorNombre ?? null;
      } catch {
        // ignore parse errors — the author name is not required
      }
      return { student, ok: true as const, status: 201, message: undefined, registradoPorNombre, refreshedAccessToken: result.refreshedAccessToken };
    }),
  );

  const createdCount = outcomes.filter((o) => o.ok).length;
  const failedOutcomes = outcomes.filter((o) => !o.ok);
  const failed = failedOutcomes.map((o) => ({
    personaId: o.student.personaId,
    message: o.message ?? "No se pudo registrar la asistencia.",
  }));
  const registradoPorNombre = outcomes.find((o) => o.ok && o.registradoPorNombre != null)?.registradoPorNombre ?? null;

  // When every student failed, mirror the real status of the first backend
  // failure instead of guessing "502 Bad Gateway" (issue #309 — a 403
  // permissions rule was coming out as 502, sending the trainer into a
  // retry loop that can never succeed). A partial success still answers 201:
  // the batch tolerates per-student failure by design (see doc comment
  // above), so the top-level status stays "created" either way.
  const status = createdCount > 0 ? 201 : failedOutcomes[0].status;

  const response = NextResponse.json({ createdCount, failed, registradoPorNombre }, { status });
  const refreshedAccessToken = outcomes.find((o) => o.refreshedAccessToken)?.refreshedAccessToken;
  if (refreshedAccessToken) {
    setAuthCookies(response, { accessToken: refreshedAccessToken });
  }
  return response;
}
