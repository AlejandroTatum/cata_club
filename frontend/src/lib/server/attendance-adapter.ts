/**
 * Translates FastAPI's `/asistencias/*` DTOs (camelCase, see backend
 * app/presentacion/schemas/asistencia_schemas.py) into the shapes the
 * attendance Route Handlers return — server-only, used by
 * src/app/api/attendance/**. Mirrors src/lib/server/payments-adapter.ts.
 *
 * Documented backend gap (do NOT work around by fabricating data):
 * `HorarioResponseDTO` has no `cancha`, `cupoMaximo`, or `activo` field —
 * those exist only on the mock-era `ScheduleSlot` type
 * (src/app/attendance/attendance-utils.ts) and have no real equivalent. This
 * adapter intentionally omits them rather than inventing placeholder values;
 * see the Fase 3 report for the follow-up this implies for `/attendance` and
 * `/trainer/attendance`.
 */

import type { NextRequest } from "next/server";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { DIA_SEMANA_LABELS, type AttendanceRecord, type TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana, EstadoAsistencia } from "@/types/domain";

// ---------------------------------------------------------------------------
// Backend DTO shapes (camelCase, as received from FastAPI)
// ---------------------------------------------------------------------------

export type BackendDiaSemana = "LUNES" | "MARTES" | "MIERCOLES" | "JUEVES" | "VIERNES" | "SABADO" | "DOMINGO";
export type BackendEstadoAsistencia = "PRESENTE" | "AUSENTE" | "ATRASADO" | "JUSTIFICADO";

export interface BackendHorario {
  id: number;
  diaSemana: BackendDiaSemana;
  horaInicio: string; // "HH:MM:SS"
  horaFin: string;
}

export interface BackendAsistencia {
  id: number;
  fechaEntrenamiento: string; // "YYYY-MM-DD"
  fechaRegistro: string;
  estado: BackendEstadoAsistencia;
  justificativo?: string | null;
  estadoJustificativo?: boolean | null;
  personaId: number;
  horarioId: number;
}

export interface BackendPersonaName {
  id: number;
  nombres: string;
  apellidos: string;
}

// ---------------------------------------------------------------------------
// Enum maps
// ---------------------------------------------------------------------------

export const DIA_SEMANA_BACKEND_TO_FRONTEND: Record<BackendDiaSemana, DiaSemana> = {
  LUNES: "lun",
  MARTES: "mar",
  MIERCOLES: "mie",
  JUEVES: "jue",
  VIERNES: "vie",
  SABADO: "sab",
  DOMINGO: "dom",
};

export const DIA_SEMANA_FRONTEND_TO_BACKEND: Record<DiaSemana, BackendDiaSemana> = {
  lun: "LUNES",
  mar: "MARTES",
  mie: "MIERCOLES",
  jue: "JUEVES",
  vie: "VIERNES",
  sab: "SABADO",
  dom: "DOMINGO",
};

export const ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND: Record<BackendEstadoAsistencia, EstadoAsistencia> = {
  PRESENTE: "present",
  AUSENTE: "absent",
  ATRASADO: "late",
  JUSTIFICADO: "justified",
};

export const ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND: Record<EstadoAsistencia, BackendEstadoAsistencia> = {
  present: "PRESENTE",
  absent: "AUSENTE",
  late: "ATRASADO",
  justified: "JUSTIFICADO",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncates a backend `"HH:MM:SS"` time string down to `"HH:MM"` — shared
 *  by every attendance/categoria adapter that reads a raw backend time
 *  field (see `buildTrainingSchedule` below and
 *  `src/app/api/attendance/categories/route.ts`). */
export function trimSeconds(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

export function personaFullName(persona: BackendPersonaName | undefined, fallback: string): string {
  return persona ? `${persona.nombres} ${persona.apellidos}`.trim() : fallback;
}

/** "Lunes 15:00 — 16:30" — used as AttendanceRecord.horario, since Horario has no name/court to label a session by. */
export function horarioLabel(horario: Pick<BackendHorario, "diaSemana" | "horaInicio" | "horaFin">): string {
  const dia = DIA_SEMANA_LABELS[DIA_SEMANA_BACKEND_TO_FRONTEND[horario.diaSemana]] ?? horario.diaSemana;
  return `${dia} ${trimSeconds(horario.horaInicio)} — ${trimSeconds(horario.horaFin)}`;
}

/**
 * Fetch every Persona referenced by `personaIds` and index by id.
 *
 * Tries the bulk roster first (`GET /personas/?limit=200`, one call) — works
 * for ADMINISTRADOR, who is the only role that endpoint is granted to:
 * `PersonaResponseDTO` carries real PII (cédula, teléfono, fecha de
 * nacimiento), so `personas_router.py` deliberately keeps the full-roster
 * read off-limits to ENTRENADOR (see the router's own comment at that
 * route). For a trainer session the bulk call 403s every time — the old
 * code swallowed that into an empty map, which made every attendance record
 * a trainer viewed fall back to the generic "Persona {id}" placeholder:
 * not a rare degradation but the 100% case for that role (ASI-4).
 *
 * ENTRENADOR already has a real, narrower grant: `GET /personas/{id}`
 * privileges ADMINISTRADOR_O_ENTRENADOR (personas_router.py, `obtener_persona`)
 * — the same per-id access the "pasar lista" roster already relies on. So on
 * a 403 this falls back to resolving each distinct id individually instead
 * of degrading in silence. `personaIds` is the distinct set already present
 * in the records being enriched (one page of attendance history), never the
 * whole club roster, so the fallback stays small.
 */
export async function fetchPersonaNameMap(
  request: NextRequest,
  personaIds: Iterable<number>,
): Promise<Map<number, BackendPersonaName>> {
  const bulkResult = await backendFetchAuthed(request, "/personas/?limit=200");
  if (bulkResult.ok && bulkResult.response.ok) {
    const body = (await bulkResult.response.json()) as { items: BackendPersonaName[] };
    return new Map(body.items.map((p) => [p.id, p]));
  }

  const ids = [...new Set(personaIds)];
  const lookups = await Promise.all(
    ids.map(async (id): Promise<BackendPersonaName | null> => {
      const result = await backendFetchAuthed(request, `/personas/${id}`);
      if (!result.ok || !result.response.ok) return null;
      return (await result.response.json()) as BackendPersonaName;
    }),
  );
  return new Map(
    lookups.filter((p): p is BackendPersonaName => p !== null).map((p) => [p.id, p]),
  );
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildTrainingSchedule(horario: BackendHorario): TrainingSchedule {
  return {
    id: horario.id,
    diaSemana: DIA_SEMANA_BACKEND_TO_FRONTEND[horario.diaSemana],
    horaInicio: trimSeconds(horario.horaInicio),
    horaFin: trimSeconds(horario.horaFin),
  };
}

export function buildAttendanceRecord(
  asistencia: BackendAsistencia,
  horario: BackendHorario | undefined,
  personas: Map<number, BackendPersonaName>,
): AttendanceRecord {
  return {
    id: String(asistencia.id),
    fecha: asistencia.fechaEntrenamiento,
    horario: horario ? horarioLabel(horario) : `Horario ${asistencia.horarioId}`,
    // Independent of the label above: the id comes off the record itself, so
    // a `/asistencias/horarios` lookup that failed costs the caller the
    // pretty name but never the ability to address the session.
    horarioId: asistencia.horarioId,
    personaId: asistencia.personaId,
    estudiante: personaFullName(personas.get(asistencia.personaId), `Persona ${asistencia.personaId}`),
    estado: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[asistencia.estado],
  };
}

// ---------------------------------------------------------------------------
// "Últimas listas del club" (Fix 8 / DSH-2)
// ---------------------------------------------------------------------------

/** `GET /asistencias/ultimas-listas` DTO — a session (horario + fecha) with
 *  at least one Asistencia, and its four counts. No author: `Asistencia`
 *  deliberately doesn't record who took the list (modelos.py:536) — see
 *  decisiones-de-negocio-2026-08-11.md §8. */
export interface BackendUltimaLista {
  horarioId: number;
  fechaEntrenamiento: string;
  diaSemana: BackendDiaSemana;
  horaInicio: string;
  horaFin: string;
  presentes: number;
  tardanzas: number;
  justificados: number;
  ausentes: number;
  total: number;
}

export interface RecentSession {
  horarioId: number;
  fecha: string;
  /** "Lunes 15:00 — 16:30" — same label grammar as `AttendanceRecord.horario`. */
  horario: string;
  counts: Record<EstadoAsistencia, number>;
  total: number;
}

export function buildRecentSession(lista: BackendUltimaLista): RecentSession {
  return {
    horarioId: lista.horarioId,
    fecha: lista.fechaEntrenamiento,
    horario: horarioLabel({
      diaSemana: lista.diaSemana,
      horaInicio: lista.horaInicio,
      horaFin: lista.horaFin,
    }),
    counts: {
      present: lista.presentes,
      late: lista.tardanzas,
      justified: lista.justificados,
      absent: lista.ausentes,
    },
    total: lista.total,
  };
}
