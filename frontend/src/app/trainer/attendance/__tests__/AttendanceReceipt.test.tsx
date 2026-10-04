/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AttendanceReceipt from "../AttendanceReceipt";
import type { SessionStudent } from "../attendance-utils";

const students: SessionStudent[] = [
  { id: "1", name: "Ana Torres", attendance: "present" },
  { id: "2", name: "Beto Luna", attendance: "present" },
];

function renderReceipt(failed: { personaId: number; message: string; alreadyRegistered?: boolean; registradoPorNombre?: string | null }[]) {
  const counts = { present: 0, late: 0, sick: 0, competition: 0, absent: 0 };
  render(
    <AttendanceReceipt
      selectedSchedule={null}
      confirmationHeadingRef={{ current: null }}
      result={{ createdCount: 0, failed, registradoPorNombre: null }}
      confirmedAt={new Date("2026-09-14T13:16:00Z")}
      sessionDate="2026-09-14"
      students={students}
      receiptCounts={counts}
      receiptTotal={0}
      hasFailedRecords={failed.length > 0}
      rosterLoading={false}
      retryButtonLabel="Reintentar con esos 2 alumnos"
      onRetryFailed={vi.fn()}
      onReset={vi.fn()}
      attendanceHistoryHref="/trainer/attendance/history"
      rosterError={null}
    />,
  );
}

describe("AttendanceReceipt — another trainer filed first (ENT-03)", () => {
  it("says the list was already saved, with no «Faltan» and no retry", () => {
    renderReceipt([
      { personaId: 1, message: "ya", alreadyRegistered: true, registradoPorNombre: "Carlos Mendoza" },
      { personaId: 2, message: "ya", alreadyRegistered: true, registradoPorNombre: "Carlos Mendoza" },
    ]);

    expect(screen.getByText("La lista ya estaba guardada")).toBeInTheDocument();
    expect(screen.getByText(/Registrada por Carlos Mendoza\. No se cambió nada\./)).toBeInTheDocument();
    expect(screen.queryByText(/Falta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/parcialmente/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it("does not print «No registrado» as the author when nobody is recorded (ENT-19)", () => {
    renderReceipt([]);

    expect(screen.queryByText(/No registrado/)).not.toBeInTheDocument();
  });

  it("keeps the partial receipt and the retry when somebody really failed", () => {
    renderReceipt([
      { personaId: 1, message: "ya", alreadyRegistered: true },
      { personaId: 2, message: "boom" },
    ]);

    expect(screen.getByText("Asistencia registrada parcialmente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});
