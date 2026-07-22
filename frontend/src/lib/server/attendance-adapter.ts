/**
 * Translates FastAPI's `/asistencias/*` and `/ranking/niveles*` DTOs
 * (camelCase, see backend app/presentacion/schemas/asistencia_schemas.py and
 * ranking_schemas.py) into the shapes the attendance/ranking Route Handlers
 * return — server-only, used by src/app/api/attendance/** and
 * src/app/api/ranking/**. Mirrors src/lib/server/payments-adapter.ts.
 *
 * Slice 7 update: `HorarioResponseDTO` now exposes `nivel_ranking_id`
 * (response-only, additive — see backend
 * app/presentacion/schemas/asistencia_schemas.py). `buildTrainingSchedule`
 * maps it straight through (already camelCase via the backend's alias
 * generator) so the trainer wizard can derive a horario's linked nivel
 * instead of asking the trainer to pick one manually.
 * `NivelRankingResponseDTO`/`NivelRankingConOcupacionDTO` still does not
 * expose the reverse link (nivel → horarios) — not needed for the
 * horario-driven derivation this slice implements. `HorarioResponseDTO`
 * also still has no `cancha`, `cupoMaximo`, or `activo` field — those exist
 * only on the mock-era `ScheduleSlot` type
 * (src/app/attendance/attendance-utils.ts) and have no real equivalent.
 * This adapter intentionally omits them rather than inventing placeholder
 * values.
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
  entrenadorId: number;
  /** Additive (Slice 7) — `null` when the horario has no linked nivel. */
  nivelRankingId?: number | null;
}

export interface BackendAsistencia {
  id: number;
  fechaEntrenamiento: string; // "YYYY-MM-DD"
  fechaRegistro: string;
  estado: BackendEstadoAsistencia;
  justificativo?: string | null;
  estadoJustificativo?: boolean | null;
  personaId: number;
  entrenadorId: number;
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

function trimSeconds(hhmmss: string): string {
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
 * Fetch every Persona once and index by id, instead of one lookup per
 * record — same small-scale N+1 tradeoff documented in payments-adapter.ts.
 * Returns an empty map (never throws) if the lookup fails; callers fall
 * back to a "Persona {id}" placeholder via `personaFullName`.
 */
export async function fetchPersonaNameMap(request: NextRequest): Promise<Map<number, BackendPersonaName>> {
  const result = await backendFetchAuthed(request, "/personas/?limit=200");
  if (!result.ok || !result.response.ok) return new Map();
  const body = (await result.response.json()) as { items: BackendPersonaName[] };
  return new Map(body.items.map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildTrainingSchedule(
  horario: BackendHorario,
  personas: Map<number, BackendPersonaName>,
): TrainingSchedule {
  return {
    id: horario.id,
    diaSemana: DIA_SEMANA_BACKEND_TO_FRONTEND[horario.diaSemana],
    horaInicio: trimSeconds(horario.horaInicio),
    horaFin: trimSeconds(horario.horaFin),
    entrenadorId: horario.entrenadorId,
    entrenadorNombre: personaFullName(personas.get(horario.entrenadorId), `Entrenador ${horario.entrenadorId}`),
    nivelRankingId: horario.nivelRankingId ?? null,
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
    estudiante: personaFullName(personas.get(asistencia.personaId), `Persona ${asistencia.personaId}`),
    estado: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[asistencia.estado],
    entrenador: personaFullName(personas.get(asistencia.entrenadorId), `Persona ${asistencia.entrenadorId}`),
  };
}
