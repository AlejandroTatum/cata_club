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
  fetchNotificaciones: (params?: unknown) => mockFetchNotificaciones(params),
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

  describe("older pages and unread count", (): void => {
    const pageOf = (ids: number[], total: number, noLeidas: number, skip = 0) => ({
      items: ids.map((id) => makeNotificacion({ id, leida: false })),
      total,
      skip,
      limit: 20,
      noLeidas,
    });
    const range = (from: number, to: number): number[] =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i);

    it("asks for the first page explicitly and reports there is more to load", async (): Promise<void> => {
      mockFetchNotificaciones.mockResolvedValue(pageOf(range(1, 20), 45, 45));

      const { result } = renderHook(() => useNotificaciones(true));

      await waitFor(() => expect(result.current.notificaciones).toHaveLength(20));
      expect(mockFetchNotificaciones).toHaveBeenCalledWith({ skip: 0, limit: 20 });
      expect(result.current.hasMore).toBe(true);
    });

    it("loadMore requests the next page and appends it, until nothing is left", async (): Promise<void> => {
      mockFetchNotificaciones
        .mockResolvedValueOnce(pageOf(range(1, 20), 25, 25))
        .mockResolvedValueOnce(pageOf(range(21, 25), 25, 25, 20));

      const { result } = renderHook(() => useNotificaciones(true));
      await waitFor(() => expect(result.current.notificaciones).toHaveLength(20));

      await act(async () => {
        result.current.loadMore();
      });

      await waitFor(() => expect(result.current.notificaciones).toHaveLength(25));
      expect(mockFetchNotificaciones).toHaveBeenLastCalledWith({ skip: 20, limit: 20 });
      expect(result.current.notificaciones.map((n) => n.id)).toEqual(range(1, 25));
      expect(result.current.hasMore).toBe(false);
    });

    it("keeps older pages that were loaded when the poll refreshes the first page", async (): Promise<void> => {
      vi.useFakeTimers();
      try {
        mockFetchNotificaciones
          .mockResolvedValueOnce(pageOf(range(1, 20), 25, 25))
          .mockResolvedValueOnce(pageOf(range(21, 25), 25, 25, 20))
          .mockResolvedValue(pageOf(range(1, 20), 25, 24));

        const { result } = renderHook(() => useNotificaciones(true));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => {
          result.current.loadMore();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.notificaciones).toHaveLength(25);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });

        expect(result.current.notificaciones).toHaveLength(25);
        expect(result.current.noLeidas).toBe(24);
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses the server's unread count, not the loaded rows, and keeps it right on mark-read", async (): Promise<void> => {
      mockFetchNotificaciones.mockResolvedValue(pageOf(range(1, 20), 45, 45));

      const { result } = renderHook(() => useNotificaciones(true));
      await waitFor(() => expect(result.current.noLeidas).toBe(45));

      act(() => {
        result.current.markRead(1);
      });

      expect(result.current.noLeidas).toBe(44);
    });

    it("falls back to counting loaded rows when the server sends no unread count", async (): Promise<void> => {
      mockFetchNotificaciones.mockResolvedValue(makePaginated([makeNotificacion({ id: 1 }), makeNotificacion({ id: 2, leida: true })]));

      const { result } = renderHook(() => useNotificaciones(true));

      await waitFor(() => expect(result.current.noLeidas).toBe(1));
    });
  });
});
