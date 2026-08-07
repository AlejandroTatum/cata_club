/**
 * Composes FastAPI's `/personas/{id}`, `/personas/{id}/representados`,
 * and `/asistencias/persona/{id}` into the `StudentPortalView` shape
 * `src/app/student/page.tsx` renders — server-only, used by
 * `src/app/api/student/route.ts`. Mirrors members-adapter.ts /
 * attendance-adapter.ts (pure builders here, fetching in the route handler).
 *
 * Documented backend gap (do NOT work around by fabricating data): there is
 * no endpoint that lets a student/representante read their own or their
 * dependents' Membresia/Pago. `GET /membresias/pagos` (the only listing
 * endpoint) is ADMINISTRADOR-only (see membresias_pagos_router.py), and
 * `POST /membresias/pagos` requires a `membresia_id` the owner has no way to
 * discover (no `GET /personas/{id}/membresias`, and `PersonaResponseDTO`
 * carries no membership reference at all). This adapter therefore never
 * attempts to build membership/payment data — `src/app/student/page.tsx`
 * renders an explicit "not available" card for that section instead of
 * guessing or reusing the admin-only queue payments-adapter.ts/
 * members-adapter.ts consume (that reuse only works for an admin caller;
 * the student/representante's own token can't authorize it).
 */

import { horarioLabel, ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND, type BackendAsistencia, type BackendHorario } from "@/lib/server/attendance-adapter";
import type { BackendPersonaFull } from "@/lib/server/members-adapter";
import type { EstadoAsistencia } from "@/types/domain";

// ---------------------------------------------------------------------------
// View shapes returned by the Route Handler
// ---------------------------------------------------------------------------

export interface StudentSessionView {
  fecha: string;
  horario: string;
  estado: EstadoAsistencia;
}

export interface StudentProfileView {
  personaId: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  recentSessions: StudentSessionView[];
  membership: MembershipView | null;
  representante: { nombres: string; apellidos: string } | null;
  representanteId: number | null;
}

/**
 * `TipoMembresiaResponseDTO` (see backend
 * app/presentacion/schemas/membresia_pago_schemas.py) — unlike
 * payments-adapter.ts's `BackendTipoMembresia` (which only needs
 * `categoria` to label an existing payment), this carries
 * the full catalog fields needed to show real plan options on the "pending
 * enrollment" screen instead of the old hardcoded `membershipPlans` array.
 */
export interface BackendTipoMembresiaCatalogo {
  id: number;
  categoria: string;
  precio: string;
  modalidad: string;
}

export interface MembershipPlanView {
  id: string;
  nombre: string;
  precio: number;
  modalidad: string;
}

/** Membership DTO returned by the JWT-scoped `/membresias/mias` contract. */
export interface BackendMembresiaPropia {
  id: number;
  estado: string;
  personaId: number;
  montoAplicado?: string;
  tipoMembresiaId?: number;
  /**
   * Present on `MembresiaResponseDTO` (membresia_pago_schemas.py:33), which is
   * what `/membresias/mias` returns. It used to be dropped here, which is why
   * the student card had no "socio desde" date to show.
   */
  fechaActivacion?: string;
}

/** Enriched membership view for a single persona — built server-side. */
export interface MembershipView {
  id: number;
  estado: string;
  personaId: number;
  montoAplicado: string | null;
  categoria: string | null;
  modalidad: string | null;
  fechaActivacion: string | null;
}

export function buildMembershipView(
  mem: BackendMembresiaPropia,
  tiposById: Map<number, BackendTipoMembresiaCatalogo>,
): MembershipView {
  const tipo = mem.tipoMembresiaId != null ? tiposById.get(mem.tipoMembresiaId) : undefined;
  return {
    id: mem.id,
    estado: mem.estado,
    personaId: mem.personaId,
    montoAplicado: mem.montoAplicado ?? null,
    categoria: tipo?.categoria ?? null,
    modalidad: tipo?.modalidad ?? null,
    fechaActivacion: mem.fechaActivacion ?? null,
  };
}

export function buildMembershipPlans(tipos: BackendTipoMembresiaCatalogo[]): MembershipPlanView[] {
  return tipos.map((tipo) => ({
    id: String(tipo.id),
    nombre: tipo.categoria,
    precio: Number(tipo.precio),
    modalidad: tipo.modalidad,
  }));
}

export interface StudentPortalView {
  self: StudentProfileView | null;
  representados: StudentProfileView[];
  membershipPlans: MembershipPlanView[];
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

/**
 * Raised from 5 once /student/attendance existed to show a real history.
 *
 * This is a pure frontend slice, not a backend constraint: GET
 * /asistencias/persona/{id} returns the full unpaginated history
 * (AsistenciaRepositorio.listar_por_persona takes no limit/offset). At 5 the
 * portal was hiding records students already had — several have 13. The cap
 * stays because the payload is unbounded and this feeds a portal, not a report;
 * `PORTAL_SESSION_WINDOW` in the attendance screen must match it, since the
 * screen states the window in its footnote.
 */
const RECENT_SESSIONS_LIMIT = 30;

/** Most recent attendance records first, capped — real activity used as an honest substitute for "upcoming sessions" (see attendance-adapter.ts's doc comment: Horario has no link to which persona it serves, so a real future schedule can't be derived per-student). */
export function buildRecentSessions(
  historial: BackendAsistencia[],
  horariosById: Map<number, BackendHorario>,
): StudentSessionView[] {
  return [...historial]
    .sort((a, b) => (a.fechaEntrenamiento < b.fechaEntrenamiento ? 1 : a.fechaEntrenamiento > b.fechaEntrenamiento ? -1 : 0))
    .slice(0, RECENT_SESSIONS_LIMIT)
    .map((asistencia) => {
      const horario = horariosById.get(asistencia.horarioId);
      return {
        fecha: asistencia.fechaEntrenamiento,
        horario: horario ? horarioLabel(horario) : `Horario ${asistencia.horarioId}`,
        estado: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[asistencia.estado],
      };
    });
}

export function buildStudentProfileView(
  persona: BackendPersonaFull,
  recentSessions: StudentSessionView[],
  membership: MembershipView | null = null,
  representante: { nombres: string; apellidos: string } | null = null,
): StudentProfileView {
  return {
    personaId: String(persona.id),
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    fechaNacimiento: persona.fechaNacimiento,
    recentSessions,
    membership,
    representante,
    representanteId: persona.representanteId,
  };
}
