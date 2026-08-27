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
  /** The student's display name, resolved by the backend (issue #358) —
   *  replaces the per-id `/personas/{id}` fan-out this adapter used to do. */
  personaNombreCompleto: string;
  horarioId: number;
  /** Who took the list (issue #263) — nullable for legacy rows. */
  registradoPorId?: number | null;
  /** The taker's display name, already resolved by the backend. */
  registradoPorNombre?: string | null;
  /** Server-computed 30-day correction window (issue #663) — see
   *  `AttendanceRecord.correctable`'s own doc comment for why this travels
   *  as a field instead of a client-side day-diff. Optional for the same
   *  reason it is on `AttendanceRecord`: older fixtures/other consumers of
   *  this shared backend shape may not set it. */
  correctable?: boolean;
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

/** "Lunes 15:00 — 16:30" — used as AttendanceRecord.horario, since Horario has no name/court to label a session by. */
export function horarioLabel(horario: Pick<BackendHorario, "diaSemana" | "horaInicio" | "horaFin">): string {
  const dia = DIA_SEMANA_LABELS[DIA_SEMANA_BACKEND_TO_FRONTEND[horario.diaSemana]] ?? horario.diaSemana;
  return `${dia} ${trimSeconds(horario.horaInicio)} — ${trimSeconds(horario.horaFin)}`;
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
    // Resolved by the backend (issue #358) — no more per-id `/personas/{id}`
    // fan-out, which was the last PII leak that endpoint had left open to
    // ENTRENADOR (cédula, teléfono, fecha de nacimiento of any persona).
    estudiante: asistencia.personaNombreCompleto,
    estado: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[asistencia.estado],
    registradoPorId: asistencia.registradoPorId ?? null,
    registradoPorNombre: asistencia.registradoPorNombre ?? null,
    // Threaded through for the correction form (issue #389, slice 4b): it
    // pre-fills these two so a correction never has to guess, and passes them
    // back UNCHANGED on submit — the backend overwrites all three mutable
    // fields together, so omitting them would silently wipe a real
    // justificativo instead of preserving it.
    justificativo: asistencia.justificativo ?? null,
    estadoJustificativo: asistencia.estadoJustificativo ?? null,
    correctable: asistencia.correctable ?? false,
  };
}

// ---------------------------------------------------------------------------
// "Últimas listas del club" (Fix 8 / DSH-2)
// ---------------------------------------------------------------------------

/** `GET /asistencias/ultimas-listas` DTO — a session (horario + fecha) with
 *  at least one Asistencia, and its four counts. This summary card carries
 *  no author (it's counts-only): `Asistencia` now records who took the list
 *  (#263), but that author is surfaced in the history, not here. */
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
