/**
 * SessionRecordsPanel — ENT-07: a record accepted for a not-operative student, or
 * for a date before their enrolment, shows up marked for the admin's review.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("SessionRecordsPanel — pagination (issue #1616)", () => {
  const many = (n: number): AttendanceRecord[] =>
    Array.from({ length: n }, (_, i) =>
      record({ id: String(i + 1), estudiante: `Alumno ${i + 1}` }),
    );
  const renderPanel = (records: AttendanceRecord[]) =>
    render(
      <ToastProvider>
        <SessionRecordsPanel records={records} onCorrected={vi.fn()} />
      </ToastProvider>,
    );
  const rows = () =>
    within(screen.getByRole("list", { name: "Registros de la sesión" })).getAllByRole(
      "listitem",
    );

  it("shows 10 per page with the range readout and 4 pages for 33 records", () => {
    renderPanel(many(33));
    expect(rows()).toHaveLength(10);
    expect(screen.getByText(/1–10 de 33/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();

    const next = screen.getByRole("button", { name: /siguiente/i });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(rows()).toHaveLength(3);
    expect(screen.getByText("Alumno 31")).toBeInTheDocument();
    expect(screen.getByText(/31–33 de 33/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();
  });

  it("renders no pager for 10 or fewer records", () => {
    renderPanel(many(10));
    expect(rows()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
  });

  it("keeps the current page when the records are updated after a correction", () => {
    const records = many(25);
    const { rerender } = renderPanel(records);
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByText("Alumno 11")).toBeInTheDocument();

    const corrected = records.map((r) =>
      r.id === "12" ? { ...r, estado: "absent" as const } : r,
    );
    rerender(
      <ToastProvider>
        <SessionRecordsPanel records={corrected} onCorrected={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByText("Alumno 11")).toBeInTheDocument();
    expect(screen.getByText(/11–20 de 25/)).toBeInTheDocument();
  });
});
