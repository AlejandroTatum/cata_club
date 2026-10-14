/**
 * useAttendanceRoster — the roster is requested for the session date (S15).
 *
 * The backend judges `bloqueadoPorImpago` on the date it is asked for, so the
 * hook has to say which date the trainer is recording, and ask again when
 * that date changes.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAttendanceRoster } from "../useAttendanceRoster";

const mockFetchAlumnosPorHorario = vi.fn();
const mockFetchAttendanceRecords = vi.fn();

vi.mock("@/services/api", () => ({
  fetchAlumnosPorHorario: (horarioId: number, options?: unknown) =>
    mockFetchAlumnosPorHorario(horarioId, options),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
}));

const BETO = {
  id: 2,
  personaId: 10,
  personaNombreCompleto: "Beto Luna",
  horarioId: 12,
  horarioDia: "lun",
  horarioHoraInicio: "18:00",
  horarioHoraFin: "19:00",
  fechaAsignacion: "2026-01-01",
};

beforeEach(() => {
  window.sessionStorage.clear();
  // Tuesday 2026-07-21, 10:00 in Guayaquil.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-21T15:00:00Z"));
  mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([BETO]);
  mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAttendanceRoster — session date", () => {
  it("requests the roster for the requested past date", async () => {
    const { result } = renderHook(() => useAttendanceRoster());

    await act(async () => {
      await result.current.openRoster(12, "2026-07-20", "mark-attendance", vi.fn());
    });

    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(12, { fecha: "2026-07-20" });
  });

  it("requests today's date when no date was requested", async () => {
    const { result } = renderHook(() => useAttendanceRoster());

    await act(async () => {
      await result.current.openRoster(12, null, "mark-attendance", vi.fn());
    });

    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(12, { fecha: "2026-07-21" });
  });

  it("re-requests the roster when the date changes, and takes the new date's flags", async () => {
    // Blocked on the later date, current (markable) on the earlier one.
    mockFetchAlumnosPorHorario.mockImplementation(async (_id: number, options?: { fecha?: string }) => [
      { ...BETO, bloqueadoPorImpago: options?.fecha === "2026-07-21" },
    ]);
    const { result } = renderHook(() => useAttendanceRoster());

    await act(async () => {
      await result.current.openRoster(12, null, "mark-attendance", vi.fn());
    });
    expect(result.current.students[0]?.blocked).toBe(true);

    await act(async () => {
      await result.current.openRoster(12, "2026-07-14", "mark-attendance", vi.fn());
    });

    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledTimes(2);
    expect(mockFetchAlumnosPorHorario).toHaveBeenLastCalledWith(12, { fecha: "2026-07-14" });
    expect(result.current.sessionDate).toBe("2026-07-14");
    expect(result.current.students[0]?.blocked).toBeFalsy();
  });
});
