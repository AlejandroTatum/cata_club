/**
 * SessionRecordsPanel — ENT-07: a record accepted for a not-operative student, or
 * for a date before their enrolment, shows up marked for the admin's review.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import SessionRecordsPanel from "../SessionRecordsPanel";
import type { AttendanceRecord } from "../attendance-utils";

function record(overrides: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: "1",
    fecha: "2026-09-28",
    horario: "Lunes 15:00 — 16:00",
    horarioId: 1,
    personaId: 3,
    estudiante: "Ana Torres",
    estado: "present",
    correctable: false,
    ...overrides,
  };
}

describe("SessionRecordsPanel — review flag removed (issue #1578)", () => {
  it("never shows «Requiere revisión», even for flagged records", () => {
    render(
      <ToastProvider>
      <SessionRecordsPanel
        records={[
          record({ id: "1", estudiante: "Ana Torres", requiereRevision: true }),
          record({ id: "2", estudiante: "Beto Luna", requiereRevision: false }),
          record({ id: "3", estudiante: "Cami Paz" }),
        ]}
        onCorrected={vi.fn()}
      />
      </ToastProvider>,
    );

    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
    expect(screen.queryByText("Requiere revisión")).not.toBeInTheDocument();
  });
});
