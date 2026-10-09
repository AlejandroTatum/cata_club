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

  it("renders nothing when there are no coverages", async () => {
    mockFetchOnce({ items: [], total: 0 });
    const { container } = render(<BonificacionesSection />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    mockFetchOnce({ message: "boom" }, false);
    const { container } = render(<BonificacionesSection />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
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
      expect(global.fetch).toHaveBeenLastCalledWith("/api/membresias/coberturas/todas?skip=10&limit=10");
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
