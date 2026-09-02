/**
 * Tests for useNotificaciones — the shared fetch + 60s poll + mark-read
 * hook, extracted from Header.tsx so both Header and AppShell can render a
 * NotificationBell fed by one data source instead of polling independently.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNotificaciones } from "@/lib/useNotificaciones";
import type { Notificacion } from "@/types/domain";

const mockFetchNotificaciones = vi.fn();
const mockMarcarNotificacionLeida = vi.fn();
const mockMarcarTodasNotificacionesLeidas = vi.fn();

vi.mock("@/services/api", () => ({
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
  marcarTodasNotificacionesLeidas: () => mockMarcarTodasNotificacionesLeidas(),
}));

function makeNotificacion(overrides: Partial<Notificacion> = {}): Notificacion {
  return {
    id: 1,
    tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
    mensaje: "Tu membresía vence pronto.",
    leida: false,
    fechaCreacion: "2026-07-19T10:00:00Z",
    entidadRelacionadaId: 5,
    ...overrides,
  };
}

function makePaginated(items: Notificacion[]): {
  items: Notificacion[];
  total: number;
  skip: number;
  limit: number;
} {
  return { items, total: items.length, skip: 0, limit: 20 };
}

describe("useNotificaciones", (): void => {
  beforeEach((): void => {
    mockFetchNotificaciones.mockReset().mockResolvedValue(makePaginated([]));
    mockMarcarNotificacionLeida.mockReset().mockResolvedValue(undefined);
    mockMarcarTodasNotificacionesLeidas.mockReset().mockResolvedValue({ actualizadas: 0 });
  });

  it("does not fetch when disabled", (): void => {
    renderHook(() => useNotificaciones(false));

    expect(mockFetchNotificaciones).not.toHaveBeenCalled();
  });

  it("fetches notificaciones on mount when enabled", async (): Promise<void> => {
    mockFetchNotificaciones.mockResolvedValue(makePaginated([makeNotificacion()]));

    const { result } = renderHook(() => useNotificaciones(true));

    await waitFor(() => expect(result.current.notificaciones).toHaveLength(1));
    expect(mockFetchNotificaciones).toHaveBeenCalledTimes(1);
  });

  it("schedules a 60s poll and clears it on unmount", (): void => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { unmount } = renderHook(() => useNotificaciones(true));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("sets loadError when the fetch fails", async (): Promise<void> => {
    mockFetchNotificaciones.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useNotificaciones(true));

    await waitFor(() => expect(result.current.loadError).toBe(true));
  });

  it("optimistically marks a notification read and rolls back on failure", async (): Promise<void> => {
    mockFetchNotificaciones.mockResolvedValue(makePaginated([makeNotificacion({ id: 7, leida: false })]));
    mockMarcarNotificacionLeida.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useNotificaciones(true));
    await waitFor(() => expect(result.current.notificaciones).toHaveLength(1));

    act(() => {
      result.current.markRead(7);
    });

    expect(result.current.notificaciones[0]?.leida).toBe(true);

    await waitFor(() => expect(result.current.notificaciones[0]?.leida).toBe(false));
  });

  it("does not call the API when there are no unread notifications", async (): Promise<void> => {
    mockFetchNotificaciones.mockResolvedValue(makePaginated([makeNotificacion({ id: 1, leida: true })]));

    const { result } = renderHook(() => useNotificaciones(true));
    await waitFor(() => expect(result.current.notificaciones).toHaveLength(1));

    act(() => {
      result.current.marcarTodasLeidas();
    });

    expect(mockMarcarTodasNotificacionesLeidas).not.toHaveBeenCalled();
  });

  it("optimistically marks every notification read, and reflects the in-flight state", async (): Promise<void> => {
    mockFetchNotificaciones.mockResolvedValue(
      makePaginated([
        makeNotificacion({ id: 1, leida: false }),
        makeNotificacion({ id: 2, leida: false }),
      ]),
    );
    let resolver: (value: { actualizadas: number }) => void = () => {};
    mockMarcarTodasNotificacionesLeidas.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    const { result } = renderHook(() => useNotificaciones(true));
    await waitFor(() => expect(result.current.notificaciones).toHaveLength(2));

    act(() => {
      result.current.marcarTodasLeidas();
    });

    expect(result.current.notificaciones.every((n) => n.leida)).toBe(true);
    expect(result.current.marcandoTodas).toBe(true);

    await act(async () => {
      resolver({ actualizadas: 2 });
    });

    await waitFor(() => expect(result.current.marcandoTodas).toBe(false));
  });

  it("rolls back and reports an error when marking all read fails", async (): Promise<void> => {
    mockFetchNotificaciones.mockResolvedValue(
      makePaginated([makeNotificacion({ id: 1, leida: false })]),
    );
    mockMarcarTodasNotificacionesLeidas.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useNotificaciones(true));
    await waitFor(() => expect(result.current.notificaciones).toHaveLength(1));

    act(() => {
      result.current.marcarTodasLeidas();
    });

    expect(result.current.notificaciones[0]?.leida).toBe(true);

    await waitFor(() => expect(result.current.notificaciones[0]?.leida).toBe(false));
    expect(result.current.marcandoTodas).toBe(false);
    expect(result.current.errorMarcarTodas).toBe(true);
  });
});
