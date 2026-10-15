import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BonificacionesSection } from "../BonificacionesSection";

function mockFetchOnce(body: unknown, ok = true) {
  vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "Content-Type": "application/json" } }),
  );
}

const item = {
  id: 4,
  personaId: 9,
  personaNombreCompleto: "Ana Pérez",
  membresiaId: 3,
  monto: "0.00",
  fechaInicio: "2026-08-01",
  fechaFin: "2026-09-01",
  otorgadaEn: "2026-08-01T09:00:00Z",
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("BonificacionesSection (admin review)", () => {
  it("lists each 100% coverage with $0,00 and an official receipt link", async () => {
    mockFetchOnce({ items: [item], total: 1 });
    render(<BonificacionesSection />);

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /bonificaciones/i })).toBeInTheDocument();
    expect(screen.getByText("$0,00")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /recibo oficial/i });
    expect(link).toHaveAttribute("href", "/api/membresias/coberturas/4/comprobante");
  });

  it("shows an empty state when there are no coverages", async () => {
    mockFetchOnce({ items: [], total: 0 });
    render(<BonificacionesSection />);
    expect(await screen.findByText("Aún no hay bonificaciones")).toBeInTheDocument();
  });

  it("offers a retry when the request fails", async () => {
    mockFetchOnce({ message: "boom" }, false);
    mockFetchOnce({ items: [item], total: 1 });
    render(<BonificacionesSection />);

    expect(await screen.findByText("No se pudieron cargar las bonificaciones.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });

  describe("search", () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...item, id: from + i, personaNombreCompleto: `Persona ${from + i}` }));

    it("drains every page so a name beyond the first batch is found", async () => {
      mockFetchOnce({ items: page(1, 10), total: 250 });
      mockFetchOnce({ items: page(1, 200), total: 250 });
      mockFetchOnce({ items: page(201, 50), total: 250 });
      const { rerender } = render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      rerender(<BonificacionesSection query="persona 249" />);

      expect(await screen.findByText("Persona 249")).toBeInTheDocument();
      expect(screen.queryByText("Persona 1")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("1 de 1");
      expect(global.fetch).toHaveBeenCalledWith("/api/membresias/coberturas/todas?skip=0&limit=200", expect.anything());
      expect(global.fetch).toHaveBeenLastCalledWith("/api/membresias/coberturas/todas?skip=200&limit=200", expect.anything());
    });

    it("shows the error state, not a spinner, when the drain fails, and recovers on retry", async () => {
      mockFetchOnce({ items: page(1, 10), total: 250 });
      mockFetchOnce({ message: "boom" }, false);
      const { rerender } = render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      rerender(<BonificacionesSection query="persona 249" />);

      expect(await screen.findByText("No se pudieron cargar las bonificaciones.")).toBeInTheDocument();
      expect(screen.queryByText("Cargando bonificaciones…")).not.toBeInTheDocument();

      mockFetchOnce({ items: page(1, 10), total: 250 });
      mockFetchOnce({ items: page(1, 200), total: 250 });
      mockFetchOnce({ items: page(201, 50), total: 250 });
      fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

      expect(await screen.findByText("Persona 249")).toBeInTheDocument();
    });

    it("aborts a superseded drain when the query changes and when the section unmounts", async () => {
      const signals: AbortSignal[] = [];
      const fetchSpy = vi.spyOn(global, "fetch");
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: page(1, 10), total: 250 }), { status: 200 }),
      );
      fetchSpy.mockImplementation((_url, init) => {
        signals.push(init!.signal as AbortSignal);
        return new Promise<Response>(() => {});
      });
      const { rerender, unmount } = render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      rerender(<BonificacionesSection query="pe" />);
      await waitFor(() => expect(signals).toHaveLength(1));
      expect(signals[0].aborted).toBe(false);

      rerender(<BonificacionesSection query="per" />);
      await waitFor(() => expect(signals).toHaveLength(2));
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);

      unmount();
      expect(signals[1].aborted).toBe(true);
    });

    it("does not treat a full first page as complete when the total is missing", async () => {
      mockFetchOnce({ items: page(1, 10) });
      mockFetchOnce({ items: page(1, 200) });
      mockFetchOnce({ items: page(201, 50) });
      const { rerender } = render(<BonificacionesSection />);
      await screen.findByText("Persona 1");
      expect(screen.getByRole("button", { name: /cargar más/i })).toBeInTheDocument();

      rerender(<BonificacionesSection query="persona 249" />);

      expect(await screen.findByText("Persona 249")).toBeInTheDocument();
      expect(global.fetch).toHaveBeenLastCalledWith("/api/membresias/coberturas/todas?skip=200&limit=200", expect.anything());
    });

    it("stops draining when a page brings no new coverage, even without a total", async () => {
      // A backend that ignored `skip` would hand back the same full page forever.
      let calls = 0;
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        calls += 1;
        const items = calls === 1 ? page(1, 10) : calls > 20 ? [] : page(1, 200);
        return new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json" } });
      });
      const { rerender } = render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      rerender(<BonificacionesSection query="persona 150" />);

      expect(await screen.findByText("Persona 150")).toBeInTheDocument();
      expect(calls).toBeLessThanOrEqual(3);
    });

    it("treats a short first page without a total as the whole set", async () => {
      mockFetchOnce({ items: page(1, 3) });
      render(<BonificacionesSection />);
      await screen.findByText("Persona 1");
      expect(screen.queryByRole("button", { name: /cargar más/i })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("3 de 3");
    });

    it("shows a search-specific empty state when nobody matches", async () => {
      mockFetchOnce({ items: [item], total: 1 });
      const { rerender } = render(<BonificacionesSection />);
      await screen.findByText("Ana Pérez");

      rerender(<BonificacionesSection query="zzz" />);

      expect(await screen.findByText("Ninguna bonificación coincide con la búsqueda")).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...item, id: from + i, personaNombreCompleto: `Persona ${from + i}` }));

    it("shows no load-more control when everything fits in the first page", async () => {
      mockFetchOnce({ items: page(1, 10), total: 10 });
      render(<BonificacionesSection />);
      await screen.findByText("Persona 1");
      expect(screen.queryByRole("button", { name: /cargar más/i })).not.toBeInTheDocument();
    });

    it("states how many of the total are on screen and keeps the receipt link quiet", async () => {
      mockFetchOnce({ items: page(1, 10), total: 15 });
      render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      expect(screen.getByRole("status")).toHaveTextContent("10 de 15");
      expect(screen.getAllByRole("link", { name: /recibo oficial/i })[0].className).not.toMatch(/bg-coal/);
    });

    it("loads the next page and appends it while total exceeds what is shown", async () => {
      mockFetchOnce({ items: page(1, 10), total: 15 });
      mockFetchOnce({ items: page(11, 5), total: 15 });
      render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      fireEvent.click(screen.getByRole("button", { name: /cargar más/i }));

      expect(await screen.findByText("Persona 15")).toBeInTheDocument();
      expect(screen.getByText("Persona 1")).toBeInTheDocument();
      expect(global.fetch).toHaveBeenLastCalledWith("/api/membresias/coberturas/todas?skip=10&limit=10", expect.anything());
      expect(screen.queryByRole("button", { name: /cargar más/i })).not.toBeInTheDocument();
    });

    it("keeps the list and offers a retry when loading more fails", async () => {
      mockFetchOnce({ items: page(1, 10), total: 15 });
      mockFetchOnce({ message: "boom" }, false);
      render(<BonificacionesSection />);
      await screen.findByText("Persona 1");

      fireEvent.click(screen.getByRole("button", { name: /cargar más/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar más bonificaciones. Intenta de nuevo.");
      expect(screen.getByText("Persona 1")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cargar más/i })).toBeEnabled();
    });
  });
});
