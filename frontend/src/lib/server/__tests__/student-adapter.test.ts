/**
 * Unit tests for the student portal adapter's pure translation functions.
 * Network-touching composition (fetchProfile/fetchRanking) is covered
 * indirectly through the Route Handler tests, which mock `global.fetch`.
 */

import { describe, it, expect } from "vitest";
import {
  buildRecentSessions,
  buildStudentProfileView,
  buildRankingView,
  buildMembershipPlans,
  type BackendPerfilRanking,
  type BackendTipoMembresiaCatalogo,
} from "../student-adapter";
import type { BackendAsistencia, BackendHorario } from "../attendance-adapter";
import type { BackendPersonaFull } from "../members-adapter";

describe("buildRecentSessions", () => {
  const horario: BackendHorario = { id: 1, diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00", entrenadorId: 2, nivelRankingId: null };
  const horariosById = new Map([[1, horario]]);

  function asistencia(overrides: Partial<BackendAsistencia>): BackendAsistencia {
    return {
      id: 1,
      fechaEntrenamiento: "2026-07-01",
      fechaRegistro: "2026-07-01T10:00:00",
      estado: "PRESENTE",
      personaId: 5,
      entrenadorId: 2,
      horarioId: 1,
      ...overrides,
    };
  }

  it("sorts by fecha descending (most recent first)", () => {
    const result = buildRecentSessions(
      [
        asistencia({ id: 1, fechaEntrenamiento: "2026-07-01" }),
        asistencia({ id: 2, fechaEntrenamiento: "2026-07-15" }),
        asistencia({ id: 3, fechaEntrenamiento: "2026-07-08" }),
      ],
      horariosById,
    );
    expect(result.map((s) => s.fecha)).toEqual(["2026-07-15", "2026-07-08", "2026-07-01"]);
  });

  it("caps the portal window at 30 sessions", () => {
    // Raised from 5 once /student/attendance existed to show a real history:
    // the backend returns the full unpaginated record, and at 5 the portal was
    // hiding sessions students already had. The cap remains because the payload
    // is unbounded and this feeds a portal, not a report.
    const many = Array.from({ length: 40 }, (_, i) =>
      asistencia({ id: i, fechaEntrenamiento: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    expect(buildRecentSessions(many, horariosById)).toHaveLength(30);
  });

  it("returns everything when the record is shorter than the window", () => {
    const few = Array.from({ length: 8 }, (_, i) => asistencia({ id: i, fechaEntrenamiento: `2026-07-0${i + 1}` }));
    expect(buildRecentSessions(few, horariosById)).toHaveLength(8);
  });

  it("maps estado and resolves the horario label", () => {
    const [session] = buildRecentSessions([asistencia({ estado: "JUSTIFICADO" })], horariosById);
    expect(session.estado).toBe("justified");
    expect(session.horario).toBe("Lunes 15:00 — 16:30");
  });

  it("falls back to a placeholder horario label when unresolved", () => {
    const [session] = buildRecentSessions([asistencia({ horarioId: 99 })], new Map());
    expect(session.horario).toBe("Horario 99");
  });
});

describe("buildRankingView", () => {
  it("maps an available perfil without leaking dead posicion/puntaje fields", () => {
    const perfil: BackendPerfilRanking = {
      personaId: 5,
      nivelRankingId: 1,
      nivelRankingNombre: "Avanzados",
      estaEnRanking: true,
    };
    expect(buildRankingView(perfil)).toEqual({
      status: "available",
      nivelNombre: "Avanzados",
      estaEnRanking: true,
    });
  });
});

describe("buildStudentProfileView", () => {
  const persona: BackendPersonaFull = {
    id: 5,
    nombres: "Sofia",
    apellidos: "Alumna",
    telefono: "0999999005",
    fechaNacimiento: "1995-01-01",
    representanteId: null,
  };

  it("combines persona + ranking + sessions into a profile view", () => {
    const profile = buildStudentProfileView(persona, { status: "unavailable", reason: "forbidden" }, []);
    expect(profile).toEqual({
      personaId: "5",
      nombres: "Sofia",
      apellidos: "Alumna",
      fechaNacimiento: "1995-01-01",
      representante: null,
      representanteId: null,
      ranking: { status: "unavailable", reason: "forbidden" },
      recentSessions: [],
      membership: null,
    });
  });
});

describe("buildMembershipPlans", () => {
  it("maps the real TipoMembresia catalog into display plans", () => {
    const tipos: BackendTipoMembresiaCatalogo[] = [
      { id: 1, categoria: "Mensual", franjaHoraria: "Tarde", precio: "85.00", modalidad: "MENSUAL" },
      { id: 2, categoria: "Personalizado", franjaHoraria: "Mañana", precio: "120.50", modalidad: "PERSONALIZADA" },
    ];
    expect(buildMembershipPlans(tipos)).toEqual([
      { id: "1", nombre: "Mensual", precio: 85, franjaHoraria: "Tarde", modalidad: "MENSUAL" },
      { id: "2", nombre: "Personalizado", precio: 120.5, franjaHoraria: "Mañana", modalidad: "PERSONALIZADA" },
    ]);
  });

  it("returns an empty array for an empty catalog", () => {
    expect(buildMembershipPlans([])).toEqual([]);
  });
});
