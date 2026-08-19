/**
 * Unit tests for the attendance/ranking adapter's pure translation functions.
 */

import { describe, it, expect } from "vitest";
import {
  DIA_SEMANA_BACKEND_TO_FRONTEND,
  DIA_SEMANA_FRONTEND_TO_BACKEND,
  ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND,
  ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND,
  horarioLabel,
  buildTrainingSchedule,
  buildAttendanceRecord,
  buildRecentSession,
  type BackendHorario,
  type BackendAsistencia,
  type BackendUltimaLista,
} from "../attendance-adapter";

describe("DIA_SEMANA maps", () => {
  it("round-trips every backend day through the frontend map and back", () => {
    for (const backendDia of Object.keys(DIA_SEMANA_BACKEND_TO_FRONTEND) as (keyof typeof DIA_SEMANA_BACKEND_TO_FRONTEND)[]) {
      const frontendDia = DIA_SEMANA_BACKEND_TO_FRONTEND[backendDia];
      expect(DIA_SEMANA_FRONTEND_TO_BACKEND[frontendDia]).toBe(backendDia);
    }
  });

  it("covers the full civil week including Sunday (DOMINGO/dom)", () => {
    expect(DIA_SEMANA_BACKEND_TO_FRONTEND.DOMINGO).toBe("dom");
    expect(DIA_SEMANA_FRONTEND_TO_BACKEND.dom).toBe("DOMINGO");
  });
});

describe("ESTADO_ASISTENCIA maps", () => {
  it("round-trips every backend estado through the frontend map and back", () => {
    for (const backendEstado of Object.keys(ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND) as (keyof typeof ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND)[]) {
      const frontendEstado = ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[backendEstado];
      expect(ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND[frontendEstado]).toBe(backendEstado);
    }
  });
});

describe("horarioLabel", () => {
  it("formats day + trimmed HH:mm range", () => {
    const label = horarioLabel({ diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00" });
    expect(label).toBe("Lunes 15:00 — 16:30");
  });

  it("formats a Sunday (DOMINGO) horario", () => {
    const label = horarioLabel({ diaSemana: "DOMINGO", horaInicio: "09:00:00", horaFin: "12:00:00" });
    expect(label).toBe("Domingo 09:00 — 12:00");
  });
});

describe("buildTrainingSchedule", () => {
  const horario: BackendHorario = { id: 1, diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00" };

  it("maps a backend Horario into a TrainingSchedule (no trainer — issue #13)", () => {
    expect(buildTrainingSchedule(horario)).toEqual({
      id: 1,
      diaSemana: "lun",
      horaInicio: "15:00",
      horaFin: "16:30",
    });
  });
});

describe("buildAttendanceRecord", () => {
  const asistencia: BackendAsistencia = {
    id: 1,
    fechaEntrenamiento: "2026-07-18",
    fechaRegistro: "2026-07-18T16:26:55.036299",
    estado: "PRESENTE",
    justificativo: null,
    estadoJustificativo: null,
    personaId: 3,
    personaNombreCompleto: "Sofia Alumna",
    horarioId: 1,
    registradoPorId: 7,
    registradoPorNombre: "Carlos Ruiz",
  };
  const horario: BackendHorario = { id: 1, diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00" };

  it("builds a fully-resolved AttendanceRecord", () => {
    expect(buildAttendanceRecord(asistencia, horario)).toEqual({
      id: "1",
      fecha: "2026-07-18",
      horario: "Lunes 15:00 — 16:30",
      horarioId: 1,
      personaId: 3,
      estudiante: "Sofia Alumna",
      estado: "present",
      registradoPorId: 7,
      registradoPorNombre: "Carlos Ruiz",
      justificativo: null,
      estadoJustificativo: null,
    });
  });

  it("threads justificativo/estadoJustificativo through for the correction form (issue #389)", () => {
    const conJustificativo: BackendAsistencia = {
      ...asistencia,
      estado: "JUSTIFICADO",
      justificativo: "Certificado médico",
      estadoJustificativo: true,
    };
    const built = buildAttendanceRecord(conJustificativo, horario);
    expect(built.justificativo).toBe("Certificado médico");
    expect(built.estadoJustificativo).toBe(true);
  });

  it("carries the persisted taker (issue #263), not a browser-side name", () => {
    const built = buildAttendanceRecord(asistencia, horario);
    expect(built.registradoPorId).toBe(7);
    expect(built.registradoPorNombre).toBe("Carlos Ruiz");
  });

  it("maps a null taker (legacy row) to null, not a fabricated name", () => {
    const legacy: BackendAsistencia = { ...asistencia, registradoPorId: null, registradoPorNombre: null };
    const built = buildAttendanceRecord(legacy, horario);
    expect(built.registradoPorId).toBeNull();
    expect(built.registradoPorNombre).toBeNull();
  });

  it("keeps the raw horarioId even when the label falls back to a placeholder", () => {
    // The two are independent: the label needs `/asistencias/horarios` to have
    // answered, the id comes straight off the record. A failed schedule lookup
    // must not cost the caller the id it would use to address the session.
    const built = buildAttendanceRecord(asistencia, undefined);
    expect(built.horarioId).toBe(1);
  });

  it("falls back to a placeholder horario label when the schedule can't be resolved", () => {
    const built = buildAttendanceRecord(asistencia, undefined);
    expect(built.horario).toBe("Horario 1");
  });

  // Issue #358: the name now travels straight in the DTO (`personaNombreCompleto`,
  // resolved by the backend join to Persona) — there is no lookup map left to
  // fall back from, so this locks that the adapter reads it directly, without
  // ever synthesizing a "Persona {id}" placeholder itself.
  it("reads the student name straight off the DTO, never synthesizing a placeholder", () => {
    const otro: BackendAsistencia = { ...asistencia, personaId: 9, personaNombreCompleto: "Mateo Rodríguez" };
    const built = buildAttendanceRecord(otro, horario);
    expect(built.estudiante).toBe("Mateo Rodríguez");
  });
});

describe("buildRecentSession", () => {
  const lista: BackendUltimaLista = {
    horarioId: 1,
    fechaEntrenamiento: "2026-08-03",
    diaSemana: "LUNES",
    horaInicio: "15:00:00",
    horaFin: "16:30:00",
    presentes: 5,
    tardanzas: 1,
    justificados: 1,
    ausentes: 1,
    total: 8,
  };

  it("builds a RecentSession with the four counts keyed by frontend estado", () => {
    expect(buildRecentSession(lista)).toEqual({
      horarioId: 1,
      fecha: "2026-08-03",
      horario: "Lunes 15:00 — 16:30",
      counts: { present: 5, late: 1, justified: 1, absent: 1 },
      total: 8,
    });
  });

  it("carries no author field — the club's list, not any one trainer's", () => {
    const built = buildRecentSession(lista);
    expect(built).not.toHaveProperty("entrenadorId");
    expect(built).not.toHaveProperty("registradoPor");
  });
});
